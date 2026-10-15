from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    EstoqueDocumento,
    EstoqueReserva,
    EstoqueReservaEvento,
    EstoqueSaldo,
    Lote,
)
from app.services.motor_estoque import (
    EstoqueErro,
    _agora,
    _bloquear_chave,
    _custo,
    _dinheiro,
    _obter_produto,
    _obter_saldo,
    _proximo_numero_documento,
    _qtd,
    _recalcular_lote,
    _recalcular_produto,
    _registrar_item,
    _validar_local,
    _validar_lote,
)
from app.services.regras_movimento import (
    MOVIMENTOS_SAIDA,
)
from app.services.unidades_estoque import (
    converter_quantidade_estoque,
)


class ReservaErro(Exception):
    pass


def _normalizar_id(valor: Any) -> str:
    return str(valor or "").strip()


def _restante_reserva(
    reserva: EstoqueReserva,
) -> Decimal:
    return _qtd(
        _qtd(reserva.quantidade)
        - _qtd(reserva.quantidade_consumida)
    )


def _criar_evento(
    db: Session,
    *,
    reserva_id: str,
    tipo: str,
    quantidade: Decimal,
    usuario_id: str,
    documento_estoque_id: str | None = None,
    motivo: str | None = None,
):
    evento = EstoqueReservaEvento(
        reserva_id=reserva_id,
        tipo=tipo,
        quantidade=_qtd(quantidade),
        usuario_id=usuario_id,
        documento_estoque_id=(
            documento_estoque_id
        ),
        motivo=motivo,
    )

    db.add(evento)


def _criar_reserva_posicao(
    db: Session,
    *,
    saldo: EstoqueSaldo,
    quantidade: Decimal,
    usuario_id: str,
    origem_modulo: str,
    documento_origem_id: str,
    referencia: str | None,
    observacao: str | None,
) -> EstoqueReserva:
    atual = _qtd(
        saldo.quantidade
    )

    reservado = _qtd(
        saldo.quantidade_reservada
    )

    disponivel = _qtd(
        atual - reservado
    )

    if quantidade > disponivel:
        raise ReservaErro(
            "Saldo disponível insuficiente para reserva. "
            f"Disponível: {disponivel}. "
            f"Solicitado: {quantidade}."
        )

    reserva = EstoqueReserva(
        saldo_id=saldo.id,
        produto_id=saldo.produto_id,
        deposito_id=saldo.deposito_id,
        gaveta_id=saldo.gaveta_id or "",
        lote_id=saldo.lote_id or "",
        quantidade=quantidade,
        quantidade_consumida=Decimal("0"),
        status="ativa",
        origem_modulo=origem_modulo,
        documento_origem_id=documento_origem_id,
        referencia=referencia,
        usuario_id=usuario_id,
        observacao=observacao,
    )

    db.add(reserva)
    db.flush()

    saldo.quantidade_reservada = _qtd(
        reservado + quantidade
    )

    _criar_evento(
        db,
        reserva_id=reserva.id,
        tipo="RESERVA",
        quantidade=quantidade,
        usuario_id=usuario_id,
        motivo=observacao,
    )

    return reserva



def _obter_reservas_idempotentes(
    db: Session,
    *,
    produto_id: str,
    deposito_id: str,
    gaveta_id: str,
    lote_id: str,
    quantidade: Decimal,
    origem_modulo: str,
    documento_origem_id: str,
) -> list[EstoqueReserva]:
    # Uma reserva FEFO pode ocupar v??rios lotes.
    # A idempot??ncia ?? por origem/documento/produto/local.

    chave = (
        "idempotencia:reserva:"
        f"{origem_modulo}:"
        f"{documento_origem_id}:"
        f"{produto_id}:"
        f"{deposito_id}:"
        f"{gaveta_id}:"
        f"{lote_id}"
    )

    _bloquear_chave(
        db,
        chave,
    )

    stmt = (
        select(EstoqueReserva)
        .where(
            EstoqueReserva.origem_modulo
            == origem_modulo,
            EstoqueReserva.documento_origem_id
            == documento_origem_id,
            EstoqueReserva.produto_id
            == produto_id,
            EstoqueReserva.deposito_id
            == deposito_id,
            EstoqueReserva.gaveta_id
            == gaveta_id,
            EstoqueReserva.status
            != "cancelada",
        )
        .order_by(
            EstoqueReserva.created_at,
            EstoqueReserva.id,
        )
        .with_for_update()
    )

    if lote_id:
        stmt = stmt.where(
            EstoqueReserva.lote_id
            == lote_id
        )

    existentes = db.scalars(
        stmt
    ).all()

    if not existentes:
        return []

    total_original = sum(
        (
            _qtd(reserva.quantidade)
            for reserva in existentes
        ),
        Decimal("0"),
    )

    quantidade = _qtd(
        quantidade
    )

    if _qtd(total_original) != quantidade:
        raise ReservaErro(
            "J?? existe uma reserva ativa/consumida para esta origem "
            "com quantidade diferente. Cancele/estorne a opera????o "
            "anterior antes de reenviar."
        )

    return list(existentes)


def reservar_estoque(
    db: Session,
    *,
    produto_id: str,
    deposito_id: str,
    quantidade: Any,
    usuario_id: str,
    origem_modulo: str,
    documento_origem_id: str,
    gaveta_id: str = "",
    lote_id: str = "",
    unidade: str | None = None,
    referencia: str | None = None,
    observacao: str | None = None,
) -> list[EstoqueReserva]:
    produto_id = _normalizar_id(
        produto_id
    )

    deposito_id = _normalizar_id(
        deposito_id
    )

    gaveta_id = _normalizar_id(
        gaveta_id
    )

    lote_id = _normalizar_id(
        lote_id
    )

    origem_modulo = (
        origem_modulo or ""
    ).strip()

    documento_origem_id = (
        documento_origem_id or ""
    ).strip()

    if not origem_modulo:
        raise ReservaErro(
            "Origem da reserva é obrigatória."
        )

    if not documento_origem_id:
        raise ReservaErro(
            "Documento de origem da reserva é obrigatório."
        )

    try:
        with db.begin():
            produto, setor = _obter_produto(
                db,
                produto_id,
            )

            _validar_local(
                db,
                deposito_id,
                gaveta_id,
            )

            try:
                conversao = (
                    converter_quantidade_estoque(
                        produto,
                        quantidade,
                        unidade,
                    )
                )
            except ValueError as erro:
                raise ReservaErro(
                    str(erro)
                )

            quantidade_base = _qtd(
                conversao[
                    "quantidade_base"
                ]
            )

            existentes = _obter_reservas_idempotentes(
                db,
                produto_id=produto.id,
                deposito_id=deposito_id,
                gaveta_id=gaveta_id,
                lote_id=lote_id,
                quantidade=quantidade_base,
                origem_modulo=origem_modulo,
                documento_origem_id=documento_origem_id,
            )

            if existentes:
                return existentes

            controla_validade = bool(
                setor
                and setor.controla_validade
            )

            reservas: list[
                EstoqueReserva
            ] = []

            #
            # PRODUTO SEM CONTROLE DE LOTE
            #
            if not controla_validade:
                saldo = _obter_saldo(
                    db,
                    produto_id=produto.id,
                    deposito_id=deposito_id,
                    gaveta_id=gaveta_id,
                    lote_id="",
                    tipo_estoque="livre",
                    criar=False,
                )

                if saldo is None:
                    raise ReservaErro(
                        "Não existe saldo nessa posição de estoque."
                    )

                reserva = _criar_reserva_posicao(
                    db,
                    saldo=saldo,
                    quantidade=quantidade_base,
                    usuario_id=usuario_id,
                    origem_modulo=origem_modulo,
                    documento_origem_id=documento_origem_id,
                    referencia=referencia,
                    observacao=observacao,
                )

                reservas.append(
                    reserva
                )

            #
            # LOTE INFORMADO MANUALMENTE
            #
            elif lote_id:
                _validar_lote(
                    db,
                    produto.id,
                    lote_id,
                )

                saldo = _obter_saldo(
                    db,
                    produto_id=produto.id,
                    deposito_id=deposito_id,
                    gaveta_id=gaveta_id,
                    lote_id=lote_id,
                    tipo_estoque="livre",
                    criar=False,
                )

                if saldo is None:
                    raise ReservaErro(
                        "Não existe saldo para o lote informado."
                    )

                reserva = _criar_reserva_posicao(
                    db,
                    saldo=saldo,
                    quantidade=quantidade_base,
                    usuario_id=usuario_id,
                    origem_modulo=origem_modulo,
                    documento_origem_id=documento_origem_id,
                    referencia=referencia,
                    observacao=observacao,
                )

                reservas.append(
                    reserva
                )

            #
            # FEFO AUTOMÁTICO
            #
            else:
                _bloquear_chave(
                    db,
                    (
                        f"reserva-fefo:"
                        f"{produto.id}:"
                        f"{deposito_id}:"
                        f"{gaveta_id}"
                    ),
                )

                candidatos = db.execute(
                    select(
                        EstoqueSaldo,
                        Lote,
                    )
                    .join(
                        Lote,
                        Lote.id
                        == EstoqueSaldo.lote_id,
                    )
                    .where(
                        EstoqueSaldo.produto_id
                        == produto.id,
                        EstoqueSaldo.deposito_id
                        == deposito_id,
                        EstoqueSaldo.gaveta_id
                        == gaveta_id,
                        EstoqueSaldo.tipo_estoque
                        == "livre",
                        EstoqueSaldo.quantidade
                        > EstoqueSaldo.quantidade_reservada,
                    )
                    .order_by(
                        Lote.data_validade.asc(),
                        EstoqueSaldo.updated_at.asc(),
                    )
                ).all()

                restante = quantidade_base

                for saldo_candidato, lote in candidatos:
                    if restante <= 0:
                        break

                    saldo = _obter_saldo(
                        db,
                        produto_id=produto.id,
                        deposito_id=deposito_id,
                        gaveta_id=gaveta_id,
                        lote_id=lote.id,
                        tipo_estoque="livre",
                        criar=False,
                    )

                    if saldo is None:
                        continue

                    disponivel = _qtd(
                        _qtd(
                            saldo.quantidade
                        )
                        - _qtd(
                            saldo.quantidade_reservada
                        )
                    )

                    if disponivel <= 0:
                        continue

                    reservar = min(
                        disponivel,
                        restante,
                    )

                    reserva = _criar_reserva_posicao(
                        db,
                        saldo=saldo,
                        quantidade=reservar,
                        usuario_id=usuario_id,
                        origem_modulo=origem_modulo,
                        documento_origem_id=documento_origem_id,
                        referencia=referencia,
                        observacao=observacao,
                    )

                    reservas.append(
                        reserva
                    )

                    restante = _qtd(
                        restante - reservar
                    )

                if restante > 0:
                    raise ReservaErro(
                        "Saldo disponível insuficiente "
                        "nos lotes para realizar a reserva. "
                        f"Faltam {restante}."
                    )

            db.flush()

        for reserva in reservas:
            db.refresh(
                reserva
            )

        return reservas

    except EstoqueErro as erro:
        db.rollback()
        raise ReservaErro(
            str(erro)
        )

    except Exception:
        db.rollback()
        raise


def cancelar_reserva(
    db: Session,
    *,
    reserva_id: str,
    usuario_id: str,
    motivo: str,
) -> EstoqueReserva:
    motivo = (
        motivo or ""
    ).strip()

    if len(motivo) < 3:
        raise ReservaErro(
            "Informe o motivo do cancelamento."
        )

    try:
        with db.begin():
            reserva = db.scalar(
                select(
                    EstoqueReserva
                )
                .where(
                    EstoqueReserva.id
                    == reserva_id
                )
                .with_for_update()
            )

            if reserva is None:
                raise ReservaErro(
                    "Reserva não encontrada."
                )

            if reserva.status != "ativa":
                raise ReservaErro(
                    "Somente reservas ativas podem ser canceladas."
                )

            restante = _restante_reserva(
                reserva
            )

            if restante <= 0:
                raise ReservaErro(
                    "A reserva não possui saldo pendente."
                )

            saldo = _obter_saldo(
                db,
                produto_id=reserva.produto_id,
                deposito_id=reserva.deposito_id,
                gaveta_id=reserva.gaveta_id,
                lote_id=reserva.lote_id,
                tipo_estoque="livre",
                criar=False,
            )

            if saldo is None:
                raise ReservaErro(
                    "Posição de estoque da reserva não encontrada."
                )

            reservado_atual = _qtd(
                saldo.quantidade_reservada
            )

            if reservado_atual < restante:
                raise ReservaErro(
                    "Inconsistência detectada no saldo reservado."
                )

            saldo.quantidade_reservada = _qtd(
                reservado_atual
                - restante
            )

            reserva.status = "cancelada"
            reserva.cancelada_em = _agora()

            _criar_evento(
                db,
                reserva_id=reserva.id,
                tipo="CANCELAMENTO",
                quantidade=restante,
                usuario_id=usuario_id,
                motivo=motivo,
            )

            db.flush()

        db.refresh(
            reserva
        )

        return reserva

    except Exception:
        db.rollback()
        raise


def consumir_reserva(
    db: Session,
    *,
    reserva_id: str,
    quantidade: Any,
    usuario_id: str,
    tipo_movimento: str = "SAIDA_CONSUMO",
    observacao: str | None = None,
) -> tuple[
    EstoqueReserva,
    EstoqueDocumento,
]:
    tipo_movimento = (
        tipo_movimento
        or ""
    ).strip().upper()

    if tipo_movimento not in MOVIMENTOS_SAIDA:
        raise ReservaErro(
            "O consumo de uma reserva exige "
            "um tipo de movimento de saída."
        )

    quantidade_consumir = _qtd(
        quantidade
    )

    if quantidade_consumir <= 0:
        raise ReservaErro(
            "A quantidade deve ser maior que zero."
        )

    try:
        with db.begin():
            reserva = db.scalar(
                select(
                    EstoqueReserva
                )
                .where(
                    EstoqueReserva.id
                    == reserva_id
                )
                .with_for_update()
            )

            if reserva is None:
                raise ReservaErro(
                    "Reserva não encontrada."
                )

            if reserva.status != "ativa":
                raise ReservaErro(
                    "Somente reservas ativas podem ser consumidas."
                )

            restante = _restante_reserva(
                reserva
            )

            if quantidade_consumir > restante:
                raise ReservaErro(
                    "Quantidade maior que o saldo restante "
                    "da reserva. "
                    f"Restante: {restante}."
                )

            produto, _ = _obter_produto(
                db,
                reserva.produto_id,
            )

            saldo = _obter_saldo(
                db,
                produto_id=reserva.produto_id,
                deposito_id=reserva.deposito_id,
                gaveta_id=reserva.gaveta_id,
                lote_id=reserva.lote_id,
                tipo_estoque="livre",
                criar=False,
            )

            if saldo is None:
                raise ReservaErro(
                    "Posição de estoque da reserva não encontrada."
                )

            fisico = _qtd(
                saldo.quantidade
            )

            reservado = _qtd(
                saldo.quantidade_reservada
            )

            if reservado < quantidade_consumir:
                raise ReservaErro(
                    "Inconsistência detectada: "
                    "saldo reservado menor que o consumo solicitado."
                )

            if fisico < quantidade_consumir:
                raise ReservaErro(
                    "Inconsistência detectada: "
                    "estoque físico menor que a reserva."
                )

            custo_unitario = _custo(
                saldo.custo_medio
            )

            valor_saida = _dinheiro(
                quantidade_consumir
                * custo_unitario
            )

            novo_fisico = _qtd(
                fisico
                - quantidade_consumir
            )

            novo_reservado = _qtd(
                reservado
                - quantidade_consumir
            )

            novo_valor = _dinheiro(
                _dinheiro(
                    saldo.valor_total
                )
                - valor_saida
            )

            saldo.quantidade = novo_fisico
            saldo.quantidade_reservada = (
                novo_reservado
            )

            if novo_fisico <= 0:
                saldo.quantidade = Decimal("0")
                saldo.valor_total = Decimal("0")
                saldo.custo_medio = Decimal("0")
            else:
                if novo_valor < 0:
                    novo_valor = Decimal("0")

                saldo.valor_total = novo_valor

            documento = EstoqueDocumento(
                numero=_proximo_numero_documento(
                    db
                ),
                tipo_movimento=tipo_movimento,
                status="rascunho",
                origem_modulo=reserva.origem_modulo,
                documento_origem_id=(
                    reserva.documento_origem_id
                ),
                referencia_externa=(
                    reserva.referencia
                ),
                data_documento=_agora(),
                usuario_id=usuario_id,
                observacao=(
                    observacao
                    or (
                        "Consumo da reserva "
                        f"{reserva.id}"
                    )
                ),
            )

            db.add(
                documento
            )
            db.flush()

            _registrar_item(
                db,
                documento=documento,
                item_numero=1,
                produto_id=reserva.produto_id,
                quantidade=quantidade_consumir,
                unidade=produto.unidade or "UN",
                quantidade_informada=quantidade_consumir,
                unidade_informada=produto.unidade or "UN",
                fator_conversao=Decimal("1"),
                deposito_origem_id=reserva.deposito_id,
                gaveta_origem_id=reserva.gaveta_id,
                lote_origem_id=reserva.lote_id,
                custo_unitario=custo_unitario,
                observacao=(
                    f"Consumo da reserva "
                    f"{reserva.id}"
                ),
            )

            nova_consumida = _qtd(
                _qtd(
                    reserva.quantidade_consumida
                )
                + quantidade_consumir
            )

            reserva.quantidade_consumida = (
                nova_consumida
            )

            if (
                nova_consumida
                >= _qtd(reserva.quantidade)
            ):
                reserva.status = "consumida"
                reserva.consumida_em = _agora()

            _recalcular_produto(
                db,
                reserva.produto_id,
            )

            if reserva.lote_id:
                _recalcular_lote(
                    db,
                    reserva.lote_id,
                )

            documento.status = "contabilizado"
            documento.contabilizado_em = _agora()
            documento.contabilizado_por_id = (
                usuario_id
            )

            _criar_evento(
                db,
                reserva_id=reserva.id,
                tipo="CONSUMO",
                quantidade=quantidade_consumir,
                usuario_id=usuario_id,
                documento_estoque_id=documento.id,
                motivo=observacao,
            )

            db.flush()

        db.refresh(
            reserva
        )

        db.refresh(
            documento
        )

        return (
            reserva,
            documento,
        )

    except EstoqueErro as erro:
        db.rollback()
        raise ReservaErro(
            str(erro)
        )

    except Exception:
        db.rollback()
        raise


def saldo_reserva(
    reserva: EstoqueReserva,
) -> dict[str, Any]:
    total = _qtd(
        reserva.quantidade
    )

    consumido = _qtd(
        reserva.quantidade_consumida
    )

    restante = _qtd(
        total - consumido
    )

    return {
        "quantidade_reservada_original": float(
            total
        ),
        "quantidade_consumida": float(
            consumido
        ),
        "quantidade_restante": float(
            max(
                restante,
                Decimal("0"),
            )
        ),
        "status": reserva.status,
    }
