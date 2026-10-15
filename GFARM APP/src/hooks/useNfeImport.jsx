import { useState } from 'react';
import { api } from '@/api/apiClient';
import { estoqueApi } from '@/api/estoqueClient';
import { useToast } from '@/components/ui/use-toast';
import {
  parseNfeXml,
  validarItemNfe,
} from '@/lib/nfeParser';
import { setorControlaValidade } from '@/lib/lotes';
import { convertQtyForProduto } from '@/lib/units';


export function useNfeImport({
  produtos,
  setores,
  onImported,
}) {
  const [importing, setImporting] =
    useState(false);

  const [preview, setPreview] =
    useState(null);

  const { toast } = useToast();


  async function processFile(file) {
    if (!file) return;

    setImporting(true);

    try {
      const xmlText =
        await file.text();

      const {
        nNF,
        emitente,
        chave,
        items,
      } = parseNfeXml(xmlText);

      if (items.length === 0) {
        toast({
          title:
            'Nenhum item encontrado',
          description:
            'O XML não contém produtos para importar.',
          variant: 'destructive',
        });

        return;
      }

      setPreview({
        nNF,
        emitente,
        chave,
        items,
      });
    } catch (err) {
      toast({
        title:
          'Erro ao importar XML',
        description:
          err.message ||
          'Não foi possível processar o arquivo.',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  }


  async function confirm(
    editedItems,
    nfData
  ) {
    setImporting(true);

    try {
      const numeroNf =
        nfData?.numero_nf ??
        preview.nNF;

      const fornecedor =
        nfData?.fornecedor ??
        preview.emitente;

      const chaveAcesso =
        nfData?.chave_acesso ??
        preview.chave;

      const chaveBusca =
        String(
          chaveAcesso || ''
        ).trim();

      if (chaveBusca) {
        const existentes =
          await estoqueApi
            .buscarDocumentos({
              origem_modulo: 'nfe',
              referencia_externa:
                chaveBusca,
              tipo_movimento:
                'ENTRADA_COMPRA',
              status:
                'contabilizado',
              limit: 10,
            });

        if (existentes.length > 0) {
          toast({
            title:
              'NF-e já importada',
            description:
              'Esta nota fiscal já está ativa no estoque. Estorne a entrada anterior para reimportá-la.',
            variant:
              'destructive',
          });

          return;
        }
      }

      let matched = 0;
      let unmatched = 0;
      let convertidos = 0;

      const divergencias = [];
      const itensMovimento = [];
      const atualizacoesProduto = [];

      for (
        let indice = 0;
        indice < editedItems.length;
        indice++
      ) {
        const item =
          editedItems[indice];

        if (
          item.create_new ||
          !item.produto_id
        ) {
          unmatched++;
          continue;
        }

        const produto =
          (produtos || []).find(
            (p) =>
              p.id === item.produto_id
          );

        if (!produto) {
          unmatched++;
          continue;
        }

        const depositoId =
          item.deposito_id ||
          produto.deposito_id ||
          '';

        if (!depositoId) {
          unmatched++;
          continue;
        }

        const gavetaId =
          item.gaveta_id ||
          produto.gaveta_id ||
          '';

        const prodParaConv = {
          ...produto,
        };

        const fatorCustom =
          Number(item.fator_custom) ||
          0;

        if (fatorCustom > 0) {
          prodParaConv.unidade_alt =
            item.uCom;

          prodParaConv.fator_conversao =
            fatorCustom;
        }

        const valItem =
          validarItemNfe(item);

        if (!valItem.ok) {
          divergencias.push(
            `${item.xProd || item.cProd}: esperado R$ ${valItem.esperado}, lido R$ ${item.vProd}`
          );
        }

        const conversao =
          convertQtyForProduto(
            item.qCom,
            item.uCom,
            prodParaConv
          );

        const qtdBase =
          Number(conversao.qtd) || 0;

        const qtdInformada =
          Number(item.qCom) || 0;

        if (
          !(qtdBase > 0) ||
          !(qtdInformada > 0)
        ) {
          unmatched++;
          continue;
        }

        if (conversao.convertido) {
          convertidos++;
        }

        const controlaValidade =
          setorControlaValidade(
            produto.setor_id,
            setores
          );

        if (
          controlaValidade &&
          !item.data_validade
        ) {
          throw new Error(
            `Validade obrigatória para ${produto.nome}.`
          );
        }

        const valorTotal =
          Number(item.vProd) || 0;

        const valorUnitarioNfe =
          Number(item.vUnCom) || 0;

        const fatorEfetivo =
          qtdInformada > 0
            ? qtdBase /
              qtdInformada
            : 1;

        const custoBase =
          valorTotal > 0
            ? valorTotal / qtdBase
            : (
                fatorEfetivo > 0
                  ? valorUnitarioNfe /
                    fatorEfetivo
                  : valorUnitarioNfe
              );

        itensMovimento.push({
          produto_id:
            produto.id,
          quantidade:
            qtdInformada,
          unidade:
            item.uCom ||
            produto.unidade ||
            'un',
          fator_conversao:
            fatorCustom > 0
              ? fatorCustom
              : undefined,
          deposito_destino_id:
            depositoId,
          gaveta_destino_id:
            gavetaId,
          custo_unitario:
            custoBase,
          data_validade:
            controlaValidade
              ? item.data_validade
              : undefined,
          observacao:
            `NFITEM:${indice} | ${item.xProd || produto.nome}`,
        });

        atualizacoesProduto.push({
          produto,
          dados: {
            ...(fatorCustom > 0
              ? {
                  unidade_alt:
                    item.uCom,
                  fator_conversao:
                    fatorCustom,
                }
              : {}),
            maquina_id:
              item.maquina_id ||
              produto.maquina_id ||
              '',
            gaveta_id:
              gavetaId ||
              produto.gaveta_id ||
              '',
            codigo_referencia:
              item.codigo_referencia ||
              produto.codigo_referencia ||
              '',
          },
        });

        matched++;
      }

      if (itensMovimento.length === 0) {
        throw new Error(
          'Nenhum item válido foi selecionado para entrada.'
        );
      }

      const origemId =
        (
          chaveBusca ||
          `${numeroNf || 'SEM-NUMERO'}:${fornecedor || 'SEM-FORNECEDOR'}`
        )
          .slice(0, 100);

      const referencia =
        chaveBusca ||
        String(
          numeroNf || origemId
        );

      await estoqueApi.movimentar({
        tipo_movimento:
          'ENTRADA_COMPRA',
        origem_modulo:
          'nfe',
        documento_origem_id:
          origemId,
        referencia_externa:
          referencia,
        observacao:
          `NF-e ${numeroNf || ''}${
            fornecedor
              ? ` — ${fornecedor}`
              : ''
          }`,
        itens: itensMovimento,
      });

      for (
        const atualizacao
        of atualizacoesProduto
      ) {
        const {
          produto,
          dados,
        } = atualizacao;

        await api.entities
          .Produto
          .update(
            produto.id,
            dados
          );

        Object.assign(
          produto,
          dados
        );
      }

      toast({
        title:
          'Importação concluída',
        description:
          `${matched} entrada(s) registrada(s)${
            convertidos > 0
              ? `, ${convertidos} com conversão de unidade`
              : ''
          }${
            unmatched > 0
              ? `, ${unmatched} ignorado(s)`
              : ''
          }.`,
      });

      if (
        divergencias.length > 0
      ) {
        toast({
          variant: 'destructive',
          title:
            `Divergência de valor em ${divergencias.length} item(ns)`,
          description:
            divergencias
              .slice(0, 3)
              .join(' | ') +
            (
              divergencias.length > 3
                ? ' ...'
                : ''
            ),
        });
      }

      setPreview(null);
      onImported?.();
    } catch (err) {
      toast({
        title: 'Erro ao importar',
        description:
          err.message ||
          'Não foi possível concluir a importação.',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  }


  function close() {
    setPreview(null);
  }


  return {
    importing,
    preview,
    processFile,
    confirm,
    close,
  };
}