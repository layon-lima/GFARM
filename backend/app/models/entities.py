from __future__ import annotations

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import mapped_column, relationship

from app.db.database import Base
from app.models.base import EntityBaseMixin


class Abastecimento(EntityBaseMixin, Base):
    __tablename__ = "abastecimentos"

    data = mapped_column(DateTime(timezone=True), nullable=False)
    maquina_id = mapped_column(String(100), nullable=False, index=True)
    produto_id = mapped_column(String(100), nullable=False, index=True)
    quantidade = mapped_column(Float, nullable=False)
    unidade = mapped_column(String(30), nullable=True, default="un")
    operador = mapped_column(String(255), nullable=True)
    numero_mov = mapped_column(String(100), nullable=True)
    observacao = mapped_column(Text, nullable=True)
    status = mapped_column(String(30), nullable=True, default="pendente", index=True)
    foto_url = mapped_column(Text, nullable=True)
    confirmado_por = mapped_column(String(255), nullable=True)
    data_confirmacao = mapped_column(DateTime(timezone=True), nullable=True)


class AnoSafra(EntityBaseMixin, Base):
    __tablename__ = "anos_safra"

    nome = mapped_column(String(100), nullable=False)


class Cultura(EntityBaseMixin, Base):
    __tablename__ = "culturas"

    nome = mapped_column(String(255), nullable=False)


class Deposito(EntityBaseMixin, Base):
    __tablename__ = "depositos"

    numero = mapped_column(String(100), nullable=True, index=True)
    nome = mapped_column(String(255), nullable=True)
    setor_id = mapped_column(String(100), nullable=True, index=True)
    descricao = mapped_column(Text, nullable=True)


class Gaveta(EntityBaseMixin, Base):
    __tablename__ = "gavetas"

    codigo = mapped_column(String(100), nullable=False, index=True)
    descricao = mapped_column(Text, nullable=True)
    deposito_id = mapped_column(String(100), nullable=True, index=True)


class CadastroMobilePendente(EntityBaseMixin, Base):
    __tablename__ = "cadastros_mobile_pendentes"

    tipo = mapped_column(String(30), nullable=False, index=True)
    dados = mapped_column(JSON, nullable=False)
    imagem_url = mapped_column(Text, nullable=True)
    status = mapped_column(String(30), nullable=False, default="PENDENTE", index=True)
    solicitante_nome = mapped_column(String(255), nullable=True)
    analisado_por_id = mapped_column(String(100), nullable=True, index=True)
    analisado_por_nome = mapped_column(String(255), nullable=True)
    analisado_em = mapped_column(DateTime(timezone=True), nullable=True)
    motivo_rejeicao = mapped_column(Text, nullable=True)
    registro_criado_id = mapped_column(String(100), nullable=True, index=True)


class EntradaSaldoMobilePendente(EntityBaseMixin, Base):
    __tablename__ = "entradas_saldo_mobile_pendentes"

    nome_produto = mapped_column(String(255), nullable=False, index=True)
    quantidade = mapped_column(Float, nullable=False)
    unidade = mapped_column(String(30), nullable=False, default="un")
    setor_id = mapped_column(String(100), nullable=False, index=True)
    deposito_id = mapped_column(String(100), nullable=False, index=True)
    gaveta_id = mapped_column(String(100), nullable=True, index=True)
    foto_url = mapped_column(Text, nullable=True)
    status = mapped_column(String(30), nullable=False, default="PENDENTE", index=True)
    solicitante_nome = mapped_column(String(255), nullable=True)
    analisado_por_id = mapped_column(String(100), nullable=True, index=True)
    analisado_por_nome = mapped_column(String(255), nullable=True)
    analisado_em = mapped_column(DateTime(timezone=True), nullable=True)
    motivo_rejeicao = mapped_column(Text, nullable=True)
    produto_id = mapped_column(String(100), nullable=True, index=True)
    documento_estoque_id = mapped_column(String(100), nullable=True, index=True)
    data_validade = mapped_column(Date, nullable=True)


class Inventario(EntityBaseMixin, Base):
    __tablename__ = "inventarios"

    numero = mapped_column(String(100), nullable=True, index=True)
    data = mapped_column(DateTime(timezone=True), nullable=False)
    data_fechamento = mapped_column(DateTime(timezone=True), nullable=True)
    setor_id = mapped_column(String(100), nullable=False, index=True)
    setor_nome = mapped_column(String(255), nullable=True)
    criterios = mapped_column(Text, nullable=True)
    criterios_descricao = mapped_column(Text, nullable=True)
    itens = mapped_column(Text, nullable=True)
    total_itens = mapped_column(Float, nullable=True, default=0)
    total_acertos = mapped_column(Float, nullable=True, default=0)
    total_divergencias = mapped_column(Float, nullable=True, default=0)
    resultado = mapped_column(String(30), nullable=True, default="consistente")
    status = mapped_column(String(30), nullable=True, default="aberto", index=True)
    responsavel = mapped_column(String(255), nullable=True)
    observacao = mapped_column(Text, nullable=True)


class InventarioItem(EntityBaseMixin, Base):
    __tablename__ = "inventario_itens"

    inventario_id = mapped_column(String(100), nullable=False, index=True)
    produto_id = mapped_column(String(100), nullable=False, index=True)
    codigo = mapped_column(String(100), nullable=True)
    nome = mapped_column(String(255), nullable=True)
    unidade = mapped_column(String(30), nullable=True, default="un")
    qtd_sistema = mapped_column(Float, nullable=True, default=0)
    qtd_contada = mapped_column(Float, nullable=False, default=0)
    responsavel = mapped_column(String(255), nullable=True)
    data = mapped_column(DateTime(timezone=True), nullable=True)


class InventarioForaEstoque(EntityBaseMixin, Base):
    __tablename__ = "inventario_fora_estoque"

    inventario_id = mapped_column(String(100), nullable=True, index=True)
    descricao = mapped_column(String(255), nullable=False, index=True)
    quantidade = mapped_column(Float, nullable=False, default=0)
    unidade = mapped_column(String(30), nullable=True, default="un")
    foto_url = mapped_column(Text, nullable=True)
    observacao = mapped_column(Text, nullable=True)
    status = mapped_column(String(30), nullable=False, default="pendente", index=True)
    registrado_por = mapped_column(String(255), nullable=True)
    data_registro = mapped_column(DateTime(timezone=True), nullable=False)
    produto_id = mapped_column(String(100), nullable=True, index=True)
    deposito_id = mapped_column(String(100), nullable=True, index=True)
    gaveta_id = mapped_column(String(100), nullable=True, index=True)
    revisado_por = mapped_column(String(255), nullable=True)
    revisado_em = mapped_column(DateTime(timezone=True), nullable=True)
    motivo_rejeicao = mapped_column(Text, nullable=True)
    documento_estoque_id = mapped_column(String(100), nullable=True, index=True)


class Lavoura(EntityBaseMixin, Base):
    __tablename__ = "lavouras"

    nome = mapped_column(String(255), nullable=False)
    numero = mapped_column(String(100), nullable=True)
    hectares = mapped_column(Float, nullable=True, default=0)


class Lote(EntityBaseMixin, Base):
    __tablename__ = "lotes"

    produto_id = mapped_column(String(100), nullable=False, index=True)
    codigo_referencia = mapped_column(String(255), nullable=True)
    setor_id = mapped_column(String(100), nullable=True, index=True)
    deposito_id = mapped_column(String(100), nullable=True, index=True)
    maquina_id = mapped_column(String(100), nullable=True, index=True)
    gaveta_id = mapped_column(String(100), nullable=True, index=True)
    codigo_lote = mapped_column(String(150), nullable=False, index=True)
    data_validade = mapped_column(Date, nullable=False)
    quantidade = mapped_column(Float, nullable=False, default=0)
    unidade = mapped_column(String(30), nullable=True, default="un")


class Maquina(EntityBaseMixin, Base):
    __tablename__ = "maquinas"

    codigo = mapped_column(String(100), nullable=False, index=True)
    nome = mapped_column(String(255), nullable=False)
    descricao = mapped_column(Text, nullable=True)
    deposito_id = mapped_column(String(100), nullable=True, index=True)
    permite_abastecimento = mapped_column(Boolean, nullable=True, default=False)
    combustivel_id = mapped_column(String(100), nullable=True, index=True)
    combustivel_nome = mapped_column(String(255), nullable=True)



class OrdemServicoAplicacao(EntityBaseMixin, Base):
    __tablename__ = "ordens_servico_aplicacao"

    numero = mapped_column(String(100), nullable=False, index=True)
    cultura_id = mapped_column(String(100), nullable=True, index=True)
    cultura_nome = mapped_column(String(255), nullable=True)
    ano_safra = mapped_column(String(100), nullable=True, index=True)
    lavoura_id = mapped_column(String(100), nullable=False, index=True)
    lavoura_nome = mapped_column(String(255), nullable=True)
    hectares = mapped_column(Float, nullable=False, default=0)
    itens = mapped_column(Text, nullable=True)
    status = mapped_column(String(30), nullable=False, default="pendente", index=True)
    data = mapped_column(DateTime(timezone=True), nullable=False)
    data_execucao = mapped_column(DateTime(timezone=True), nullable=True)
    responsavel = mapped_column(String(255), nullable=True)
    observacao = mapped_column(Text, nullable=True)
    custo_total = mapped_column(Float, nullable=True, default=0)


class Pagamento(EntityBaseMixin, Base):
    __tablename__ = "pagamentos"

    numero = mapped_column(String(100), nullable=True, index=True)
    pedido_id = mapped_column(String(100), nullable=False, index=True)
    cliente_id = mapped_column(String(100), nullable=True, index=True)
    valor = mapped_column(Float, nullable=False, default=0)
    forma_pagamento = mapped_column(String(30), nullable=True, default="pix")
    data_pagamento = mapped_column(DateTime(timezone=True), nullable=False)
    observacao = mapped_column(Text, nullable=True)


class PedidoPesagem(EntityBaseMixin, Base):
    __tablename__ = "pedidos_pesagem"

    numero = mapped_column(String(100), nullable=True, index=True)
    cliente_id = mapped_column(String(100), nullable=False, index=True)
    produto_id = mapped_column(String(100), nullable=False, index=True)
    transportadora_ids = mapped_column(Text, nullable=True)
    transportadora_nomes = mapped_column(Text, nullable=True)
    sem_limite = mapped_column(Boolean, nullable=True, default=False)
    peso_saca_kg = mapped_column(Float, nullable=True, default=0)
    valor_saca = mapped_column(Float, nullable=True, default=0)
    qtd_sacas = mapped_column(Float, nullable=True, default=0)
    total_kg = mapped_column(Float, nullable=True, default=0)
    valor_total = mapped_column(Float, nullable=True, default=0)
    saldo_kg = mapped_column(Float, nullable=True, default=0)
    status = mapped_column(String(30), nullable=True, default="aberto", index=True)
    observacao = mapped_column(Text, nullable=True)


class Pessoa(EntityBaseMixin, Base):
    __tablename__ = "pessoas"

    nome = mapped_column(String(255), nullable=False, index=True)
    documento = mapped_column(String(50), nullable=True, index=True)
    ie = mapped_column(String(50), nullable=True, index=True)
    telefone = mapped_column(String(50), nullable=True)
    cidade = mapped_column(String(150), nullable=True)
    uf = mapped_column(String(10), nullable=True)
    endereco = mapped_column(Text, nullable=True)
    cnh = mapped_column(String(100), nullable=True)
    cnh_validade = mapped_column(Date, nullable=True)
    is_cliente = mapped_column(Boolean, nullable=True, default=False, index=True)
    is_fornecedor = mapped_column(Boolean, nullable=True, default=False, index=True)
    is_transportadora = mapped_column(Boolean, nullable=True, default=False, index=True)
    is_motorista = mapped_column(Boolean, nullable=True, default=False, index=True)
    observacao = mapped_column(Text, nullable=True)


class Produto(EntityBaseMixin, Base):
    __tablename__ = "produtos"

    codigo = mapped_column(String(100), nullable=False, index=True)
    codigo_referencia = mapped_column(String(255), nullable=True, index=True)
    nome = mapped_column(String(255), nullable=False, index=True)
    setor_id = mapped_column(String(100), nullable=False, index=True)
    deposito_id = mapped_column(String(100), nullable=True, index=True)
    maquina_id = mapped_column(String(100), nullable=True, index=True)
    gaveta_id = mapped_column(String(100), nullable=True, index=True)
    quantidade = mapped_column(Float, nullable=True, default=0)
    unidade = mapped_column(String(30), nullable=True, default="un")
    unidade_alt = mapped_column(String(30), nullable=True)
    fator_conversao = mapped_column(Float, nullable=True, default=0)
    estoque_minimo = mapped_column(Float, nullable=True, default=0)
    custo_unitario = mapped_column(Float, nullable=True, default=0)
    venda = mapped_column(Boolean, nullable=True, default=False, index=True)
    foto_url = mapped_column(Text, nullable=True)



class Setor(EntityBaseMixin, Base):
    __tablename__ = "setores"

    nome = mapped_column(String(255), nullable=False, index=True)
    descricao = mapped_column(Text, nullable=True)
    cor = mapped_column(String(30), nullable=True, default="#16a34a")
    icon = mapped_column(String(100), nullable=True, default="")
    controla_validade = mapped_column(Boolean, nullable=True, default=False)
    tem_aba_mobile = mapped_column(Boolean, nullable=True, default=False)
    permite_inventario = mapped_column(Boolean, nullable=True, default=False)


class TicketPesagem(EntityBaseMixin, Base):
    __tablename__ = "tickets_pesagem"

    numero = mapped_column(String(100), nullable=False, index=True)
    tipo = mapped_column(String(30), nullable=True, default="venda", index=True)
    produto_id = mapped_column(String(100), nullable=True, index=True)
    cliente_id = mapped_column(String(100), nullable=True, index=True)
    cliente_nome = mapped_column(String(255), nullable=True)
    transportadora_id = mapped_column(String(100), nullable=True, index=True)
    transportadora_nome = mapped_column(String(255), nullable=True)
    origem = mapped_column(String(255), nullable=True)
    destino = mapped_column(String(255), nullable=True)
    data_abertura = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    data_fechamento = mapped_column(DateTime(timezone=True), nullable=True)
    motorista = mapped_column(String(255), nullable=False)
    placa = mapped_column(String(30), nullable=False, index=True)
    peso_tara = mapped_column(Float, nullable=False, default=0)
    peso_bruto = mapped_column(Float, nullable=True, default=0)
    peso_liquido = mapped_column(Float, nullable=True, default=0)
    correcao_peso_kg = mapped_column(Float, nullable=False, default=0)
    pedido_id = mapped_column(String(100), nullable=True, index=True)
    status = mapped_column(String(30), nullable=False, default="aberto", index=True)
    observacao = mapped_column(Text, nullable=True)
    nfe_importada = mapped_column(Boolean, nullable=True, default=False)
    nfe_numero = mapped_column(String(100), nullable=True)
    nfe_produto = mapped_column(String(255), nullable=True)
    nfe_motorista = mapped_column(String(255), nullable=True)
    nfe_chave = mapped_column(String(100), nullable=True, index=True)
    nfe_cliente = mapped_column(String(255), nullable=True)
    nfe_quantidade = mapped_column(Float, nullable=True, default=0)
    nfe_valor = mapped_column(Float, nullable=True, default=0)



class User(EntityBaseMixin, Base):
    __tablename__ = "users"

    username = mapped_column(String(100), nullable=False, unique=True, index=True)
    password_hash = mapped_column(Text, nullable=False)
    display_name = mapped_column(String(255), nullable=True)
    role = mapped_column(String(30), nullable=False, default="user", index=True)

    # Campos legados mantidos apenas como projeção de compatibilidade.
    # A fonte oficial de permissões é user_permissions.
    pode_confirmar_abastecimento = mapped_column(Boolean, nullable=False, default=False)
    pode_digitar_peso = mapped_column(Boolean, nullable=False, default=False)
    pode_baixar_mobile = mapped_column(Boolean, nullable=False, default=False)
    pode_mudar_gaveta_mobile = mapped_column(Boolean, nullable=False, default=False)
    pode_mudar_deposito_mobile = mapped_column(Boolean, nullable=False, default=False)
    pode_entrada_manual_saldo_mobile = mapped_column(Boolean, nullable=False, default=False)
    paginas_permitidas = mapped_column(Text, nullable=True)
    setores_permitidos = mapped_column(Text, nullable=True)

    ativo = mapped_column(Boolean, nullable=False, default=True)

    permission_records = relationship(
        "UserPermission",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class UserPermission(EntityBaseMixin, Base):
    __tablename__ = "user_permissions"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "permission_key",
            "scope_value",
            name="uq_user_permission_scope",
        ),
    )

    user_id = mapped_column(
        String(100),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    permission_key = mapped_column(String(150), nullable=False, index=True)
    scope_value = mapped_column(String(150), nullable=False, default="", index=True)

    user = relationship("User", back_populates="permission_records")


class Veiculo(EntityBaseMixin, Base):
    __tablename__ = "veiculos"

    placa = mapped_column(String(30), nullable=False, index=True)
    modelo = mapped_column(String(255), nullable=True)
    cor = mapped_column(String(100), nullable=True)
    ano = mapped_column(String(20), nullable=True)
    tara = mapped_column(Float, nullable=True, default=0)
    capacidade_kg = mapped_column(Float, nullable=True, default=0)
    transportadora_id = mapped_column(String(100), nullable=True, index=True)
    motorista_id = mapped_column(String(100), nullable=True, index=True)
    observacao = mapped_column(Text, nullable=True)


class AuditoriaERP(EntityBaseMixin, Base):
    __tablename__ = "auditoria_erp"

    usuario_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )
    usuario_nome = mapped_column(
        String(255),
        nullable=True,
        index=True,
    )
    acao = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )
    entidade = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )
    registro_id = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )
    antes_json = mapped_column(
        Text,
        nullable=True,
    )
    depois_json = mapped_column(
        Text,
        nullable=True,
    )
    detalhe = mapped_column(
        Text,
        nullable=True,
    )
