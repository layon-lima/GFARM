"""Sem rede, sem banco real e sem certificados: valida lotes recebidos do Chrome."""
import unittest

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.distribuicao_dfe_manual import (
    DocZipBrowser,
    LoteBrowser,
    _tabelas,
    validar_lote,
)


def lote(**mudancas):
    dados = {
        "interessado": "12345678901",
        "anterior_nsu": 100,
        "ult_nsu": 102,
        "max_nsu": 250,
        "cstat": "138",
        "documentos": [
            DocZipBrowser(nsu=101, doc_zip="QUFBQUFBQUFB"),
            DocZipBrowser(nsu=102, doc_zip="QUFBQUFBQUFB"),
        ],
    }
    dados.update(mudancas)
    return LoteBrowser(**dados)


class LoteManualOfflineTest(unittest.TestCase):
    def test_cpf_e_cnpj_usam_tabelas_independentes(self):
        self.assertEqual(_tabelas("12345678901"),
                         ("gfarm_dfe_cursores_pf", "gfarm_dfe_documentos_pf", "cpf"))
        self.assertEqual(_tabelas("12345678000199"),
                         ("gfarm_dfe_cursores", "gfarm_dfe_documentos", "cnpj"))

    def test_rejeita_documentos_fora_da_ordem_ou_nsu_repetido(self):
        validar_lote(lote())
        for docs in (
            [DocZipBrowser(nsu=102, doc_zip="QUFBQUFBQUFB"),
             DocZipBrowser(nsu=101, doc_zip="QUFBQUFBQUFB")],
            [DocZipBrowser(nsu=101, doc_zip="QUFBQUFBQUFB")] * 2,
            [DocZipBrowser(nsu=100, doc_zip="QUFBQUFBQUFB")],
        ):
            with self.subTest(docs=docs):
                with self.assertRaises(HTTPException):
                    validar_lote(lote(documentos=docs))

    def test_codigo_sem_documentos_nao_avanca_nsu(self):
        for status in ("137", "656"):
            validar_lote(lote(cstat=status, ult_nsu=100, max_nsu=100,
                              documentos=[]))
            with self.assertRaises(HTTPException):
                validar_lote(lote(cstat=status, ult_nsu=101, max_nsu=101,
                                  documentos=[]))

    def test_numero_maximo_de_documentos_por_lote(self):
        docs = [DocZipBrowser(nsu=i, doc_zip="QUFBQUFBQUFB")
                for i in range(101, 152)]
        with self.assertRaises(ValidationError):
            lote(ult_nsu=151, documentos=docs)

    def test_nao_aceita_cpf_cnpj_ou_nsu_invalidos(self):
        with self.assertRaises(ValidationError):
            lote(interessado="1234")
        with self.assertRaises(HTTPException):
            validar_lote(lote(interessado="abcdefghijk"))
        with self.assertRaises(ValidationError):
            lote(anterior_nsu=-1)


if __name__ == "__main__":
    unittest.main()
