"""Importa histórico validado da pesagem do sistema legado.

Dados migrados:
- 4 pedidos, com renumeração controlada;
- 50 tickets históricos, sem duplicar os presentes no relatório de pedidos;
- 19 pagamentos reais;
- clientes/fornecedores/transportadoras necessários, reutilizando cadastros existentes.

Importante: esta migração NÃO reproduz movimentos no motor de estoque. Os tickets
são históricos e entram diretamente na tabela de pesagem para não alterar o
saldo físico atual.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import math
import re
import unicodedata
import uuid

from alembic import op
import sqlalchemy as sa


revision = "import_pesagem_legada_20261003"
down_revision = "entrada_saldo_mobile_20261002"
branch_labels = None
depends_on = None


_NAMESPACE = uuid.UUID("ff8d9462-a27a-4d43-899c-bf23aaad0d35")
_TZ_BR = timezone(timedelta(hours=-3))


PESSOAS = {
    "MAP AGRONEGOCIOS LTDA": {
        "is_cliente": True,
        "is_fornecedor": True,
    },
    "DIDI - TRANSPORTES": {
        "is_cliente": True,
        "is_fornecedor": True,
        "is_transportadora": True,
    },
    "GIL REAÇÕES & CEREAIS": {
        "is_cliente": True,
        "is_transportadora": True,
    },
    "CARLOS MARLOW - FAZENDA ALTO PARANÁ": {
        "is_cliente": True,
        "is_transportadora": True,
    },
    "TRANSPORTADORA MULTIGRAO": {
        "is_transportadora": True,
    },
}


PEDIDOS = (
    {
        "numero": "PED-000001",
        "cliente": "MAP AGRONEGOCIOS LTDA",
        "produto": "MILHO A GRANEL",
        "transportadoras": (),
        "sem_limite": False,
        "peso_saca_kg": 60.0,
        "valor_saca": 59.0,
        "qtd_sacas": 20000.0,
        "total_kg": 1200000.0,
        "valor_total": 1180000.0,
        "saldo_kg": 0.0,
        "status": "concluido",
        "created_date": "20/08/2026, 21:01:28",
    },
    {
        "numero": "PED-000002",
        "cliente": "MAP AGRONEGOCIOS LTDA",
        "produto": "MILHO A GRANEL",
        "transportadoras": ("DIDI - TRANSPORTES",),
        "sem_limite": True,
        "peso_saca_kg": 60.0,
        "valor_saca": 61.0,
        "qtd_sacas": 0.0,
        "total_kg": 0.0,
        "valor_total": 0.0,
        "saldo_kg": 0.0,
        "status": "aberto",
        "created_date": "28/08/2026, 19:49:16",
    },
    {
        "numero": "PED-000003",
        "cliente": "GIL REAÇÕES & CEREAIS",
        "produto": "MILHO A GRANEL",
        "transportadoras": ("GIL REAÇÕES & CEREAIS",),
        "sem_limite": False,
        "peso_saca_kg": 60.0,
        "valor_saca": 61.0,
        "qtd_sacas": 25220.0 / 60.0,
        "total_kg": 25220.0,
        "valor_total": 25640.33,
        "saldo_kg": 0.0,
        "status": "concluido",
        "created_date": "10/09/2026, 11:10:39",
    },
    {
        "numero": "PED-000004",
        "cliente": "CARLOS MARLOW - FAZENDA ALTO PARANÁ",
        "produto": "MILHETO A GRANEL",
        "transportadoras": ("TRANSPORTADORA MULTIGRAO",),
        "sem_limite": False,
        "peso_saca_kg": 60.0,
        "valor_saca": 50.0,
        "qtd_sacas": 267.5,
        "total_kg": 16050.0,
        "valor_total": 13375.0,
        "saldo_kg": 0.0,
        "status": "concluido",
        "created_date": "15/09/2026, 10:40:01",
    },
)


# numero|tipo|produto|cliente|transportadora|abertura|fechamento|motorista|placa|
# origem|destino|tara|bruto|liquido|pedido_novo|status|observacao|nf_importada|nf_numero
TICKETS = (
'PES-000056|entrada_saida|MILHETO A GRANEL|CARLOS MARLOW - FAZENDA ALTO PARANÁ|TRANSPORTADORA MULTIGRAO|11/09/2026, 11:54:45|11/09/2026, 15:58:35|KLEUBER RAFAEL|JAK0F29|||38230.000|75900.000|37670.000||fechado||0|',
'PES-000055|venda|MILHETO A GRANEL|CARLOS MARLOW - FAZENDA ALTO PARANÁ|TRANSPORTADORA MULTIGRAO|11/09/2026, 10:22:15|11/09/2026, 11:53:35|KLEUBER RAFAEL|JAK0F29|||22180.000|38230.000|16050.000|PED-000004|fechado|CARREGADO NA NOVO HORIZONTE|0|',
'PES-000054|entrada_saida|MILHETO A GRANEL|CARLOS MARLOW - FAZENDA ALTO PARANÁ|TRANSPORTADORA MULTIGRAO|11/09/2026, 08:25:38|11/09/2026, 13:45:34|JOSE CRISTIANO BORGES LIMA|ROJ2A84|||25720.000|90120.000|64400.000||fechado||0|',
'PES-000053|venda|MILHO A GRANEL|GIL REAÇÕES & CEREAIS|GIL REAÇÕES & CEREAIS|10/09/2026, 08:11:41|10/09/2026, 09:13:20|SAULO ANTONIO DE OLIVEIRA|QRP1H56|||13810.000|39030.000|25220.000|PED-000003|fechado||0|',
'PES-000052|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|08/09/2026, 07:30:29|08/09/2026, 11:25:26|IVAN AVELINO|SLO1H97|||26630.000|88200.000|61570.000|PED-000002|fechado||0|',
'PES-000051|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|08/09/2026, 07:30:05|08/09/2026, 11:23:05|ONESIMO|QRZ0C00|||26200.000|87760.000|61560.000|PED-000002|fechado||0|',
'PES-000050|compra|CALCARIO|DIDI - TRANSPORTES|DIDI - TRANSPORTES|07/09/2026, 10:27:45|08/09/2026, 07:26:04|ONESIMO|QRZ0C00|||87280.000|26200.000|61080.000||fechado||0|',
'PES-000049|compra|CALCARIO|DIDI - TRANSPORTES|DIDI - TRANSPORTES|07/09/2026, 10:25:20|08/09/2026, 07:28:50|IVÃ AVELINO|SLO1H97|||84320.000|26630.000|57690.000||fechado||0|',
'PES-000048|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|04/09/2026, 12:16:08|04/09/2026, 15:33:19|LUZARDO LEANDRO DE SOUSA|RSM5B03|||26390.000|88060.000|61670.000|PED-000002|fechado||0|',
'PES-000047|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|04/09/2026, 12:13:53|04/09/2026, 15:30:52|ERIVERTON|RSK2E75|||26530.000|88440.000|61910.000|PED-000002|fechado||0|',
'PES-000046|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|04/09/2026, 12:11:38|04/09/2026, 15:16:37|JOAO PAULO|SLR5C58|||26000.000|89240.000|63240.000|PED-000002|fechado||0|',
'PES-000045|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|04/09/2026, 08:24:34|04/09/2026, 11:30:05|ERNANDES ALVES DA SILVA|PIG4B76|||24710.000|95360.000|70650.000|PED-000002|fechado||0|',
'PES-000044|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|04/09/2026, 07:13:58|04/09/2026, 09:22:58|ALESI SANTOS CARVALHO|PII7I08|||26750.000|87680.000|60930.000|PED-000002|fechado||0|',
'PES-000043|compra|CALCARIO|DIDI - TRANSPORTES|DIDI - TRANSPORTES|03/09/2026, 15:53:02|04/09/2026, 07:12:48|ALESI|PII7I08||LOTE 18|88100.000|26760.000|61340.000||fechado||0|',
'PES-000042|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|03/09/2026, 09:48:24|03/09/2026, 11:57:14|FERNANDO|QRU9J64|||27120.000|87400.000|60280.000|PED-000002|fechado||0|',
'PES-000041|compra|CALCARIO|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|03/09/2026, 07:06:00|03/09/2026, 09:38:29|FERNANDO|QRU9J64||LOTE 18|83980.000|27120.000|56860.000||fechado||0|',
'PES-000040|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|01/09/2026, 13:13:57|01/09/2026, 16:27:31|IVONILDO|PIY4I97|||27050.000|87880.000|60830.000|PED-000002|fechado||0|',
'PES-000039|compra|CALCARIO|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|01/09/2026, 10:25:24|01/09/2026, 11:35:45|IVONILDO GONÇALVES DE MOURA|PIY4I97|||87240.000|29790.000|57450.000||fechado||0|',
'PES-000038|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|31/08/2026, 13:15:02|31/08/2026, 16:37:32|FRANÇUÁ|SLR5C62|||26690.000|88580.000|61890.000|PED-000002|fechado||1|1851',
'PES-000037|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|31/08/2026, 08:33:18|01/09/2026, 07:14:56|RAIMUNDO ROCHA|SLR5E52|||26740.000|88640.000|61900.000|PED-000002|fechado||1|1852',
'PES-000036|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|29/08/2026, 11:33:14|29/08/2026, 16:38:12|FRANCIVALDO|UKF1G66|||24440.000|103920.000|79480.000|PED-000002|fechado||1|1850',
'PES-000035|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|28/08/2026, 15:30:24|29/08/2026, 08:04:13|LUZARDO LEANDRO DE SOUSA|RSM5B03|||29490.000|89360.000|59870.000|PED-000002|fechado|complemento do ticket PES-000030|1|1846',
'PES-000034|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|29/08/2026, 07:09:51|29/08/2026, 10:36:55|JOÃO PAULO|SLR5C58|||26010.000|89660.000|63650.000|PED-000002|fechado||1|1849',
'PES-000033|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|29/08/2026, 07:07:11|29/08/2026, 11:07:35|ERIVELTON|RSK2E75|||26660.000|90600.000|63940.000|PED-000002|fechado||1|1848',
'PES-000032|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|29/08/2026, 07:04:47|29/08/2026, 13:08:52|ONESIMO|PIG4B76|||24710.000|96140.000|71430.000|PED-000002|fechado||1|1847',
'PES-000030|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA|DIDI - TRANSPORTES|28/08/2026, 15:30:24|29/08/2026, 08:04:13|LUZARDO LEANDRO DE SOUSA|RSM5B03|||26260.000|29490.000|3230.000|PED-000001|fechado||1|1845',
'PES-000029|entrada_saida|MILHO A GRANEL|CARLOS MARLOW - FAZENDA ALTO PARANÁ|CARLOS MARLOW - FAZENDA ALTO PARANÁ|28/08/2026, 09:46:00|28/08/2026, 10:05:00|RAILSON|TRA0000|||15170.000|28120.000|12950.000||fechado||0|',
'PES-000028|entrada_saida|MILHO A GRANEL|CARLOS MARLOW - FAZENDA ALTO PARANÁ|CARLOS MARLOW - FAZENDA ALTO PARANÁ|28/08/2026, 07:12:00|28/08/2026, 08:06:00|RAILSON|TRA0000|||15140.000|30020.000|14880.000||fechado|CARREGAMENTO MILHO DA BAZUKA|0|',
'PES-000027|compra|CALCARIO|DIDI - TRANSPORTES|DIDI - TRANSPORTES|28/08/2026, 07:06:56|28/08/2026, 10:41:16|LUZARDO LEANDRO DE SOUSA|RSM5B03||LOTE 03|86660.000|26260.000|60400.000||fechado||0|',
'PES-000026|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||27/08/2026, 11:38:41|27/08/2026, 11:39:04|FERNANDO|QRU9J64|||27110.000|88840.000|61730.000|PED-000001|fechado||1|1844',
'PES-000025|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||27/08/2026, 07:03:44|27/08/2026, 09:44:44|ALESI|PII7I08|||26930.000|89920.000|62990.000|PED-000001|fechado||1|1843',
'PES-000024|compra|CALCARIO|DIDI - TRANSPORTES|DIDI - TRANSPORTES|27/08/2026, 07:00:49|27/08/2026, 10:42:33|FERNANDO|QRU9J64||LOTE 03|88020.000|27110.000|60910.000||fechado|CALCARI|0|',
'PES-000023|avulsa|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||26/08/2026, 09:43:16|26/08/2026, 09:44:00|Françua|SLR5C62|||26660.000|88540.000|61880.000|PED-000001|fechado||1|1841',
'PES-000021|avulsa|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||26/08/2026, 07:11:18|26/08/2026, 09:57:30|IVAN AVELINO|SLO1H97|||26670.000|90660.000|63990.000|PED-000001|fechado|Milho|1|1842',
'PES-000020|compra|CALCARIO|DIDI - TRANSPORTES|DIDI - TRANSPORTES|26/08/2026, 10:30:00|26/08/2026, 12:45:00|IVÃ AVELINO|SLO1H97|||77310.000|26630.000|50680.000||fechado|CALCARIO|0|',
'PES-000019|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:49:41|24/08/2026, 14:49:53|RAIMUNDO ROCHA|SLO5E52|||26380.000|86640.000|60260.000|PED-000001|fechado||1|1840',
'PES-000018|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:48:37|24/08/2026, 14:48:59|IVONILDO|PIY4I97|||26880.000|89680.000|62800.000|PED-000001|fechado||1|',
'PES-000017|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:47:57|24/08/2026, 14:48:07|ERIVERTON|SLR1C58|||26410.000|88720.000|62310.000|PED-000001|fechado||1|',
'PES-000016|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:46:51|24/08/2026, 14:47:12|FRANCIVALDO|UKF1G66|||24580.000|103000.000|78420.000|PED-000001|fechado||1|',
'PES-000015|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:44:11|24/08/2026, 14:44:25|JOAO PAULO|SLR5C58|||25860.000|86600.000|60740.000|PED-000001|fechado||1|',
'PES-000014|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:43:16|24/08/2026, 14:43:30|FRANÇUA|SLR5C62|||26590.000|88400.000|61810.000|PED-000001|fechado||1|',
'PES-000013|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:40:22|24/08/2026, 14:40:46|LEVI|PII7I08|||26710.000|87840.000|61130.000|PED-000001|fechado||1|',
'PES-000012|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:39:28|24/08/2026, 14:39:48|IVAN AVELINO|SLO1H97|||26530.000|87560.000|61030.000|PED-000001|fechado||1|',
'PES-000011|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:38:46|24/08/2026, 14:38:59|FERNANDO|QRU9J64|||26910.000|87320.000|60410.000|PED-000001|fechado||1|',
'PES-000010|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:38:02|24/08/2026, 14:38:16|FRANCIVALDO|UKF1G66|||24620.000|102760.000|78140.000|PED-000001|fechado||1|',
'PES-000009|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:37:19|24/08/2026, 14:37:33|RAIMUNDO ROCHA|SLO5E52|||26450.000|87960.000|61510.000|PED-000001|fechado||1|',
'PES-000008|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:36:16|24/08/2026, 14:36:25|IVAN AVELINO|SLO1H97|||26600.000|88460.000|61860.000|PED-000001|fechado||1|',
'PES-000007|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:35:24|24/08/2026, 14:35:38|Eriverton|SLR1C58|||26480.000|72020.000|45540.000|PED-000001|fechado||1|',
'PES-000006|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||24/08/2026, 14:30:03|24/08/2026, 14:30:30|JOÃO PAULO|SLR5C58|||25860.000|87720.000|61860.000|PED-000001|fechado||1|',
'PES-000004|venda|MILHO A GRANEL|MAP AGRONEGOCIOS LTDA||21/08/2026, 07:12:00|21/08/2026, 17:17:35|Onesimo|PIG4B76|||24520.000|92880.000|68360.000|PED-000001|fechado||1|',
)


# numero|pedido_novo|cliente|valor|forma|data
PAGAMENTOS = (
'PAG-000002|PED-000001|MAP AGRONEGOCIOS LTDA|80000.00|pix|20/08/2026, 17:22:00',
'PAG-000001|PED-000001|MAP AGRONEGOCIOS LTDA|100000.00|pix|24/08/2026, 13:14:00',
'PAG-000003|PED-000001|MAP AGRONEGOCIOS LTDA|50000.00|pix|24/08/2026, 17:12:00',
'PAG-000004|PED-000001|MAP AGRONEGOCIOS LTDA|200000.00|pix|29/08/2026, 11:51:00',
'PAG-000005|PED-000001|MAP AGRONEGOCIOS LTDA|160000.00|pix|31/08/2026, 13:21:00',
'PAG-000006|PED-000001|MAP AGRONEGOCIOS LTDA|200000.00|pix|31/08/2026, 15:41:00',
'PAG-000007|PED-000001|MAP AGRONEGOCIOS LTDA|200000.00|pix|01/09/2026, 15:37:00',
'PAG-000008|PED-000001|MAP AGRONEGOCIOS LTDA|50000.00|pix|01/09/2026, 17:24:00',
'PAG-000009|PED-000001|MAP AGRONEGOCIOS LTDA|80000.00|pix|02/09/2026, 16:45:00',
'PAG-000010|PED-000001|MAP AGRONEGOCIOS LTDA|60000.00|pix|03/09/2026, 11:40:00',
'PAG-000011|PED-000002|MAP AGRONEGOCIOS LTDA|240000.00|pix|03/09/2026, 11:40:00',
'PAG-000012|PED-000002|MAP AGRONEGOCIOS LTDA|100000.00|pix|03/09/2026, 17:57:00',
'PAG-000013|PED-000002|MAP AGRONEGOCIOS LTDA|200000.00|pix|08/09/2026, 16:17:00',
'PAG-000015|PED-000002|MAP AGRONEGOCIOS LTDA|200000.00|pix|10/09/2026, 13:09:00',
'PAG-000016|PED-000002|MAP AGRONEGOCIOS LTDA|100000.00|pix|11/09/2026, 10:30:00',
'PAG-000017|PED-000002|MAP AGRONEGOCIOS LTDA|80000.00|pix|14/09/2026, 18:44:00',
'PAG-000019|PED-000002|MAP AGRONEGOCIOS LTDA|50000.00|pix|19/09/2026, 07:34:00',
'PAG-000014|PED-000003|GIL REAÇÕES & CEREAIS|10000.00|pix|10/09/2026, 10:11:00',
'PAG-000018|PED-000003|GIL REAÇÕES & CEREAIS|15640.33|pix|15/09/2026, 07:50:00',
)


def _norm(value: object) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", text.strip().upper())


_PRODUTO_ALIASES = {
    "MILHO A GRANEL": {
        "MILHO A GRANEL",
        "MILHO",
        "MILHO EM GRAO",
        "MILHO EM GRÃO",
    },
    "MILHETO A GRANEL": {
        "MILHETO A GRANEL",
        "MILHETO",
        "MILHETO EM GRAO",
        "MILHETO EM GRÃO",
    },
    "CALCARIO": {
        "CALCARIO",
        "CALCÁRIO",
        "CALCARIO AGRICOLA",
        "CALCÁRIO AGRÍCOLA",
    },
}


def _aliases_produto(nome: str) -> set[str]:
    return {
        _norm(alias)
        for alias in _PRODUTO_ALIASES.get(nome, {nome})
    }


def _placa(value: object) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def _dt(value: str) -> datetime:
    return datetime.strptime(
        value,
        "%d/%m/%Y, %H:%M:%S",
    ).replace(tzinfo=_TZ_BR)


def _id(chave: str) -> str:
    return str(uuid.uuid5(_NAMESPACE, chave))


def _one_by_numero(bind, table, numero: str):
    rows = bind.execute(
        sa.select(table).where(table.c.numero == numero)
    ).mappings().all()

    if len(rows) > 1:
        raise RuntimeError(
            f"Importação legada abortada: existem {len(rows)} registros "
            f"com o número {numero} em {table.name}."
        )

    return rows[0] if rows else None


def _close(a: object, b: object, tol: float = 0.01) -> bool:
    return math.isclose(
        float(a or 0),
        float(b or 0),
        abs_tol=tol,
    )


def _parse_ticket(line: str) -> dict:
    (
        numero,
        tipo,
        produto,
        cliente,
        transportadora,
        abertura,
        fechamento,
        motorista,
        placa,
        origem,
        destino,
        tara,
        bruto,
        liquido,
        pedido,
        status,
        observacao,
        nf_importada,
        nf_numero,
    ) = line.split("|")

    return {
        "numero": numero,
        "tipo": tipo,
        "produto": produto,
        "cliente": cliente or None,
        "transportadora": transportadora or None,
        "data_abertura": _dt(abertura),
        "data_fechamento": _dt(fechamento),
        "motorista": motorista,
        "placa": _placa(placa),
        "origem": origem or None,
        "destino": destino or None,
        "peso_tara": float(tara),
        "peso_bruto": float(bruto),
        "peso_liquido": float(liquido),
        "pedido": pedido or None,
        "status": status,
        "observacao": observacao or None,
        "nfe_importada": nf_importada == "1",
        "nfe_numero": nf_numero or None,
    }


def _parse_pagamento(line: str) -> dict:
    numero, pedido, cliente, valor, forma, data = line.split("|")

    return {
        "numero": numero,
        "pedido": pedido,
        "cliente": cliente,
        "valor": float(valor),
        "forma_pagamento": forma,
        "data_pagamento": _dt(data),
    }


def _validar_fonte() -> None:
    tickets = [_parse_ticket(line) for line in TICKETS]
    pagamentos = [_parse_pagamento(line) for line in PAGAMENTOS]

    if len(tickets) != 50 or len({t["numero"] for t in tickets}) != 50:
        raise RuntimeError("Fonte legada inválida: são esperados 50 tickets únicos.")

    if len(pagamentos) != 19 or len({p["numero"] for p in pagamentos}) != 19:
        raise RuntimeError("Fonte legada inválida: são esperados 19 pagamentos únicos.")

    carregado = defaultdict(float)
    for ticket in tickets:
        if ticket["pedido"]:
            carregado[ticket["pedido"]] += ticket["peso_liquido"]

    esperado_carregado = {
        "PED-000001": 1200000.0,
        "PED-000002": 1024800.0,
        "PED-000003": 25220.0,
        "PED-000004": 16050.0,
    }

    for numero, esperado in esperado_carregado.items():
        if not _close(carregado[numero], esperado):
            raise RuntimeError(
                f"Fonte legada inválida: carregado de {numero} "
                f"é {carregado[numero]}, esperado {esperado}."
            )

    pagos = defaultdict(float)
    for pagamento in pagamentos:
        pagos[pagamento["pedido"]] += pagamento["valor"]

    esperado_pago = {
        "PED-000001": 1180000.0,
        "PED-000002": 970000.0,
        "PED-000003": 25640.33,
        "PED-000004": 0.0,
    }

    for numero, esperado in esperado_pago.items():
        if not _close(pagos[numero], esperado):
            raise RuntimeError(
                f"Fonte legada inválida: pagamentos de {numero} "
                f"somam {pagos[numero]}, esperado {esperado}."
            )

    ticket_27 = next(t for t in tickets if t["numero"] == "PES-000027")
    if ticket_27["placa"] != "RSM5B03":
        raise RuntimeError("Fonte legada inválida: placa corrigida do PES-000027.")

    valor_pesado_sem_limite = carregado["PED-000002"] / 60.0 * 61.0
    if not _close(valor_pesado_sem_limite, 1041880.0):
        raise RuntimeError("Fonte legada inválida no pedido sem limite.")

    if not _close(valor_pesado_sem_limite - pagos["PED-000002"], 71880.0):
        raise RuntimeError("Fonte legada inválida no saldo financeiro sem limite.")


def upgrade() -> None:
    _validar_fonte()

    bind = op.get_bind()

    pessoas = sa.table(
        "pessoas",
        sa.column("id", sa.String(100)),
        sa.column("nome", sa.String(255)),
        sa.column("is_cliente", sa.Boolean()),
        sa.column("is_fornecedor", sa.Boolean()),
        sa.column("is_transportadora", sa.Boolean()),
        sa.column("is_motorista", sa.Boolean()),
        sa.column("created_date", sa.DateTime(timezone=True)),
        sa.column("updated_date", sa.DateTime(timezone=True)),
        sa.column("created_by_id", sa.String(100)),
    )

    produtos = sa.table(
        "produtos",
        sa.column("id", sa.String(100)),
        sa.column("codigo", sa.String(100)),
        sa.column("nome", sa.String(255)),
        sa.column("setor_id", sa.String(100)),
        sa.column("deposito_id", sa.String(100)),
        sa.column("gaveta_id", sa.String(100)),
        sa.column("quantidade", sa.Float()),
        sa.column("unidade", sa.String(30)),
        sa.column("estoque_minimo", sa.Float()),
        sa.column("custo_unitario", sa.Float()),
        sa.column("venda", sa.Boolean()),
        sa.column("created_date", sa.DateTime(timezone=True)),
        sa.column("updated_date", sa.DateTime(timezone=True)),
        sa.column("created_by_id", sa.String(100)),
    )

    setores = sa.table(
        "setores",
        sa.column("id", sa.String(100)),
        sa.column("nome", sa.String(255)),
        sa.column("descricao", sa.Text()),
        sa.column("cor", sa.String(30)),
        sa.column("icon", sa.String(100)),
        sa.column("controla_validade", sa.Boolean()),
        sa.column("tem_aba_mobile", sa.Boolean()),
        sa.column("permite_inventario", sa.Boolean()),
        sa.column("created_date", sa.DateTime(timezone=True)),
        sa.column("updated_date", sa.DateTime(timezone=True)),
        sa.column("created_by_id", sa.String(100)),
    )

    pedidos = sa.table(
        "pedidos_pesagem",
        sa.column("id", sa.String(100)),
        sa.column("numero", sa.String(100)),
        sa.column("cliente_id", sa.String(100)),
        sa.column("produto_id", sa.String(100)),
        sa.column("transportadora_ids", sa.Text()),
        sa.column("transportadora_nomes", sa.Text()),
        sa.column("sem_limite", sa.Boolean()),
        sa.column("peso_saca_kg", sa.Float()),
        sa.column("valor_saca", sa.Float()),
        sa.column("qtd_sacas", sa.Float()),
        sa.column("total_kg", sa.Float()),
        sa.column("valor_total", sa.Float()),
        sa.column("saldo_kg", sa.Float()),
        sa.column("status", sa.String(30)),
        sa.column("observacao", sa.Text()),
        sa.column("created_date", sa.DateTime(timezone=True)),
        sa.column("updated_date", sa.DateTime(timezone=True)),
        sa.column("created_by_id", sa.String(100)),
    )

    tickets = sa.table(
        "tickets_pesagem",
        sa.column("id", sa.String(100)),
        sa.column("numero", sa.String(100)),
        sa.column("tipo", sa.String(30)),
        sa.column("produto_id", sa.String(100)),
        sa.column("cliente_id", sa.String(100)),
        sa.column("cliente_nome", sa.String(255)),
        sa.column("transportadora_id", sa.String(100)),
        sa.column("transportadora_nome", sa.String(255)),
        sa.column("origem", sa.String(255)),
        sa.column("destino", sa.String(255)),
        sa.column("data_abertura", sa.DateTime(timezone=True)),
        sa.column("data_fechamento", sa.DateTime(timezone=True)),
        sa.column("motorista", sa.String(255)),
        sa.column("placa", sa.String(30)),
        sa.column("peso_tara", sa.Float()),
        sa.column("peso_bruto", sa.Float()),
        sa.column("peso_liquido", sa.Float()),
        sa.column("pedido_id", sa.String(100)),
        sa.column("status", sa.String(30)),
        sa.column("observacao", sa.Text()),
        sa.column("nfe_importada", sa.Boolean()),
        sa.column("nfe_numero", sa.String(100)),
        sa.column("created_date", sa.DateTime(timezone=True)),
        sa.column("updated_date", sa.DateTime(timezone=True)),
        sa.column("created_by_id", sa.String(100)),
    )

    pagamentos = sa.table(
        "pagamentos",
        sa.column("id", sa.String(100)),
        sa.column("numero", sa.String(100)),
        sa.column("pedido_id", sa.String(100)),
        sa.column("cliente_id", sa.String(100)),
        sa.column("valor", sa.Float()),
        sa.column("forma_pagamento", sa.String(30)),
        sa.column("data_pagamento", sa.DateTime(timezone=True)),
        sa.column("observacao", sa.Text()),
        sa.column("created_date", sa.DateTime(timezone=True)),
        sa.column("updated_date", sa.DateTime(timezone=True)),
        sa.column("created_by_id", sa.String(100)),
    )

    now = datetime.now(timezone.utc)

    # Produtos históricos: primeiro tentamos reutilizar um cadastro real por
    # alias exato. Quando ele não existe, criamos um produto histórico isolado,
    # sem depósito/gaveta e com quantidade zero. Isso preserva a referência dos
    # tickets/pedidos sem alterar o estoque físico atual.
    produto_rows = bind.execute(
        sa.select(
            produtos.c.id,
            produtos.c.codigo,
            produtos.c.nome,
        )
    ).mappings().all()

    setor_rows = bind.execute(
        sa.select(
            setores.c.id,
            setores.c.nome,
        )
    ).mappings().all()

    setor_historico = next(
        (
            row
            for row in setor_rows
            if _norm(row["nome"]) == "PESAGEM - HISTORICO"
        ),
        None,
    )
    setor_historico_id = (
        setor_historico["id"]
        if setor_historico is not None
        else None
    )

    def garantir_setor_historico() -> str:
        nonlocal setor_historico_id

        if setor_historico_id:
            return setor_historico_id

        setor_historico_id = _id("setor:pesagem-historico")
        bind.execute(
            setores.insert().values(
                id=setor_historico_id,
                nome="PESAGEM - HISTÓRICO",
                descricao=(
                    "Setor técnico criado para preservar produtos de tickets "
                    "históricos importados. Não representa saldo físico atual."
                ),
                cor="#64748b",
                icon="",
                controla_validade=False,
                tem_aba_mobile=False,
                permite_inventario=False,
                created_date=now,
                updated_date=now,
                created_by_id=None,
            )
        )
        return setor_historico_id

    produto_ids = {}
    specs_historicos = {
        "MILHO A GRANEL": {
            "codigo": "HIST-PES-MILHO",
            "venda": True,
        },
        "MILHETO A GRANEL": {
            "codigo": "HIST-PES-MILHETO",
            "venda": True,
        },
        "CALCARIO": {
            "codigo": "HIST-PES-CALCARIO",
            "venda": False,
        },
    }

    for nome, spec in specs_historicos.items():
        aliases = _aliases_produto(nome)
        matches = [
            row
            for row in produto_rows
            if _norm(row["nome"]) in aliases
        ]

        ids = {row["id"] for row in matches}

        if len(ids) == 1:
            produto_ids[nome] = matches[0]["id"]
            continue

        # Se houver múltiplos candidatos, não escolhemos arbitrariamente.
        # Procuramos somente o produto histórico determinístico desta migração.
        historico_id = _id(f"produto-historico:{_norm(nome)}")
        historico_existente = next(
            (
                row
                for row in produto_rows
                if row["id"] == historico_id
            ),
            None,
        )

        if historico_existente is None:
            bind.execute(
                produtos.insert().values(
                    id=historico_id,
                    codigo=spec["codigo"],
                    nome=nome,
                    setor_id=garantir_setor_historico(),
                    deposito_id=None,
                    gaveta_id=None,
                    quantidade=0.0,
                    unidade="kg",
                    estoque_minimo=0.0,
                    custo_unitario=0.0,
                    venda=spec["venda"],
                    created_date=now,
                    updated_date=now,
                    created_by_id=None,
                )
            )

            produto_rows.append(
                {
                    "id": historico_id,
                    "codigo": spec["codigo"],
                    "nome": nome,
                }
            )

        produto_ids[nome] = historico_id

    pessoa_rows = bind.execute(
        sa.select(
            pessoas.c.id,
            pessoas.c.nome,
            pessoas.c.is_cliente,
            pessoas.c.is_fornecedor,
            pessoas.c.is_transportadora,
            pessoas.c.is_motorista,
        )
    ).mappings().all()
    pessoas_por_nome = defaultdict(list)

    for row in pessoa_rows:
        pessoas_por_nome[_norm(row["nome"])].append(row)

    pessoa_ids = {}

    for nome, papeis in PESSOAS.items():
        matches = pessoas_por_nome[_norm(nome)]

        if len(matches) > 1:
            raise RuntimeError(
                f"Importação legada abortada: há mais de uma pessoa chamada "
                f"'{nome}'. Unifique o cadastro antes da migração."
            )

        if matches:
            row = matches[0]
            pessoa_id = row["id"]
            valores = {}

            for papel, ativo in papeis.items():
                if ativo and not bool(row[papel]):
                    valores[papel] = True

            if valores:
                valores["updated_date"] = now
                bind.execute(
                    pessoas.update()
                    .where(pessoas.c.id == pessoa_id)
                    .values(**valores)
                )
        else:
            pessoa_id = _id(f"pessoa:{_norm(nome)}")
            valores = {
                "id": pessoa_id,
                "nome": nome,
                "is_cliente": False,
                "is_fornecedor": False,
                "is_transportadora": False,
                "is_motorista": False,
                "created_date": now,
                "updated_date": now,
                "created_by_id": None,
            }
            valores.update(papeis)
            bind.execute(pessoas.insert().values(**valores))

        pessoa_ids[nome] = pessoa_id

    pedido_ids = {}

    for fonte in PEDIDOS:
        numero = fonte["numero"]
        cliente_id = pessoa_ids[fonte["cliente"]]
        produto_id = produto_ids[fonte["produto"]]
        transp_ids = [
            pessoa_ids[nome]
            for nome in fonte["transportadoras"]
        ]
        created = _dt(fonte["created_date"])

        valores = {
            "cliente_id": cliente_id,
            "produto_id": produto_id,
            "transportadora_ids": ",".join(transp_ids),
            "transportadora_nomes": ", ".join(fonte["transportadoras"]),
            "sem_limite": fonte["sem_limite"],
            "peso_saca_kg": fonte["peso_saca_kg"],
            "valor_saca": fonte["valor_saca"],
            "qtd_sacas": fonte["qtd_sacas"],
            "total_kg": fonte["total_kg"],
            "valor_total": fonte["valor_total"],
            "saldo_kg": fonte["saldo_kg"],
            "status": fonte["status"],
            "observacao": None,
            "created_date": created,
            "updated_date": created,
            "created_by_id": None,
        }

        existente = _one_by_numero(bind, pedidos, numero)

        if existente:
            if (
                existente["cliente_id"] != cliente_id
                or existente["produto_id"] != produto_id
                or bool(existente["sem_limite"]) != bool(fonte["sem_limite"])
            ):
                raise RuntimeError(
                    f"Importação legada abortada: {numero} já existe, mas "
                    "não corresponde ao pedido histórico esperado."
                )

            bind.execute(
                pedidos.update()
                .where(pedidos.c.id == existente["id"])
                .values(**valores)
            )
            pedido_id = existente["id"]
        else:
            pedido_id = _id(f"pedido:{numero}")
            bind.execute(
                pedidos.insert().values(
                    id=pedido_id,
                    numero=numero,
                    **valores,
                )
            )

        pedido_ids[numero] = pedido_id

    for line in TICKETS:
        fonte = _parse_ticket(line)
        numero = fonte["numero"]
        pedido_id = (
            pedido_ids[fonte["pedido"]]
            if fonte["pedido"]
            else None
        )
        cliente_id = (
            pessoa_ids[fonte["cliente"]]
            if fonte["cliente"]
            else None
        )
        transportadora_id = (
            pessoa_ids[fonte["transportadora"]]
            if fonte["transportadora"]
            else None
        )

        valores = {
            "tipo": fonte["tipo"],
            "produto_id": produto_ids[fonte["produto"]],
            "cliente_id": cliente_id,
            "cliente_nome": fonte["cliente"],
            "transportadora_id": transportadora_id,
            "transportadora_nome": fonte["transportadora"],
            "origem": fonte["origem"],
            "destino": fonte["destino"],
            "data_abertura": fonte["data_abertura"],
            "data_fechamento": fonte["data_fechamento"],
            "motorista": fonte["motorista"],
            "placa": fonte["placa"],
            "peso_tara": fonte["peso_tara"],
            "peso_bruto": fonte["peso_bruto"],
            "peso_liquido": fonte["peso_liquido"],
            "pedido_id": pedido_id,
            "status": fonte["status"],
            "observacao": fonte["observacao"],
            "nfe_importada": fonte["nfe_importada"],
            "nfe_numero": fonte["nfe_numero"],
            "created_date": fonte["data_abertura"],
            "updated_date": fonte["data_fechamento"],
            "created_by_id": None,
        }

        existente = _one_by_numero(bind, tickets, numero)

        if existente:
            if (
                _placa(existente["placa"]) != fonte["placa"]
                or not _close(existente["peso_tara"], fonte["peso_tara"])
                or not _close(existente["peso_bruto"], fonte["peso_bruto"])
                or not _close(existente["peso_liquido"], fonte["peso_liquido"])
            ):
                raise RuntimeError(
                    f"Importação legada abortada: {numero} já existe, "
                    "mas placa/pesos não correspondem ao histórico."
                )

            if existente["pedido_id"] not in (None, "", pedido_id):
                raise RuntimeError(
                    f"Importação legada abortada: {numero} já está vinculado "
                    "a outro pedido."
                )

            bind.execute(
                tickets.update()
                .where(tickets.c.id == existente["id"])
                .values(**valores)
            )
        else:
            bind.execute(
                tickets.insert().values(
                    id=_id(f"ticket:{numero}"),
                    numero=numero,
                    **valores,
                )
            )

    for line in PAGAMENTOS:
        fonte = _parse_pagamento(line)
        numero = fonte["numero"]
        pedido_id = pedido_ids[fonte["pedido"]]
        cliente_id = pessoa_ids[fonte["cliente"]]

        valores = {
            "pedido_id": pedido_id,
            "cliente_id": cliente_id,
            "valor": fonte["valor"],
            "forma_pagamento": fonte["forma_pagamento"],
            "data_pagamento": fonte["data_pagamento"],
            "observacao": None,
            "created_date": fonte["data_pagamento"],
            "updated_date": fonte["data_pagamento"],
            "created_by_id": None,
        }

        existente = _one_by_numero(bind, pagamentos, numero)

        if existente:
            if (
                existente["pedido_id"] != pedido_id
                or not _close(existente["valor"], fonte["valor"])
            ):
                raise RuntimeError(
                    f"Importação legada abortada: {numero} já existe, "
                    "mas não corresponde ao pagamento histórico esperado."
                )

            bind.execute(
                pagamentos.update()
                .where(pagamentos.c.id == existente["id"])
                .values(**valores)
            )
        else:
            bind.execute(
                pagamentos.insert().values(
                    id=_id(f"pagamento:{numero}"),
                    numero=numero,
                    **valores,
                )
            )


def downgrade() -> None:
    # Dados de negócio importados não são apagados automaticamente em downgrade.
    # Isso evita perda acidental de histórico e de vínculos eventualmente usados
    # após a importação.
    pass
