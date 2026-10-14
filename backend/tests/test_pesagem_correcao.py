import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import TicketPesagem


class CorrecaoPesoTicketTest(unittest.TestCase):
    def test_correcao_e_gravada_sem_alterar_pesos_originais(self):
        engine = create_engine("sqlite://")
        TicketPesagem.__table__.create(engine)

        try:
            with Session(engine) as db:
                ticket = TicketPesagem(
                    id="ticket-correto",
                    numero="TK-TESTE",
                    tipo="compra",
                    motorista="Teste",
                    placa="ABC1D23",
                    data_abertura="2026-10-14T08:00:00",
                    peso_tara=1000,
                    peso_bruto=2500,
                    peso_liquido=1490,
                    correcao_peso_kg=-10,
                    status="fechado",
                )
                db.add(ticket)
                db.commit()

                saved = db.get(TicketPesagem, "ticket-correto")
                self.assertEqual(saved.peso_tara, 1000)
                self.assertEqual(saved.peso_bruto, 2500)
                self.assertEqual(saved.peso_liquido, 1490)
                self.assertEqual(saved.correcao_peso_kg, -10)
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
