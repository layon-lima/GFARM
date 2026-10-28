import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Contact, Truck, UserRound, PackageCheck, Search, Car } from 'lucide-react';
import { api } from '@/api/apiClient';
import { invalidateEntidade, useEntidades } from '@/lib/useEntidades';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import SearchSelect from '@/components/SearchSelect';
import {
  camposNovoPerfil,
  localizarPessoaExistente,
  localizarVeiculoExistente,
  normalizarNome,
  normalizarDocumento,
  normalizarPlaca,
} from '@/lib/cadastroPesagemRapido';

const PERFIS = [
  { id: 'is_motorista', label: 'Motorista', icon: UserRound },
  { id: 'is_transportadora', label: 'Transportadora', icon: Truck },
  { id: 'is_fornecedor', label: 'Fornecedor', icon: PackageCheck },
];

const PESSOA_INICIAL = { nome: '', documento: '', telefone: '', cnh: '' };
const VEICULO_INICIAL = { placa: '', modelo: '', motorista_id: '', transportadora_id: '' };

export default function CadastroRapidoPesagem({ onIrTickets, onReload, onCadastroConcluido }) {
  const { toast } = useToast();
  // Mesmas entidades, endpoints e permissões de Cadastros > Pessoas / Veículos.
  // Sem tabelas, cópias locais persistentes ou criação de ticket antes da balança.
  const { data, loading } = useEntidades({ Pessoa: {}, Veiculo: {} });
  const pessoas = data.Pessoa || [];
  const veiculos = data.Veiculo || [];

  const [perfil, setPerfil] = useState('is_motorista');
  const [pessoaForm, setPessoaForm] = useState(PESSOA_INICIAL);
  const [pessoaExistenteId, setPessoaExistenteId] = useState('');
  const [busca, setBusca] = useState('');
  const [veiculoForm, setVeiculoForm] = useState(VEICULO_INICIAL);
  const [salvandoPessoa, setSalvandoPessoa] = useState(false);
  const [salvandoVeiculo, setSalvandoVeiculo] = useState(false);

  const pessoaSelecionada = pessoas.find((p) => p.id === pessoaExistenteId);
  const veiculoExistente = localizarVeiculoExistente(veiculos, veiculoForm.placa);

  const candidatos = useMemo(() => {
    const termo = normalizarNome(busca);
    const documento = normalizarDocumento(busca);
    if (termo.length < 2) return [];
    return pessoas.filter((p) => normalizarNome(p.nome).includes(termo)
      || (documento.length >= 3 && normalizarDocumento(p.documento).includes(documento))).slice(0, 8);
  }, [pessoas, busca]);

  const motoristas = pessoas.filter((p) => p.is_motorista);
  const transportadoras = pessoas.filter((p) => p.is_transportadora);

  function selecionarPessoa(pessoa) {
    setPessoaExistenteId(pessoa.id);
    setPessoaForm({
      nome: pessoa.nome || '',
      documento: pessoa.documento || '',
      telefone: pessoa.telefone || '',
      cnh: pessoa.cnh || '',
    });
    setBusca('');
  }

  function limparPessoa() {
    setPessoaExistenteId('');
    setPessoaForm(PESSOA_INICIAL);
    setBusca('');
  }

  async function salvarPessoa(event) {
    event.preventDefault();
    if (salvandoPessoa) return;

    if (!pessoaSelecionada && !pessoaForm.nome.trim()) {
      toast({ variant: 'destructive', title: 'Informe o nome do cadastro.' });
      return;
    }

    setSalvandoPessoa(true);
    try {
      let cadastrado = pessoaSelecionada;
      if (pessoaSelecionada) {
        if (!pessoaSelecionada[perfil]) {
          // PATCH apenas da flag escolhida: mantém todos os dados e demais perfis existentes.
          const atualizado = await api.entities.Pessoa.update(pessoaSelecionada.id, { [perfil]: true });
          cadastrado = { ...pessoaSelecionada, ...atualizado };
          toast({ title: 'Perfil habilitado no cadastro existente' });
        } else {
          toast({ title: 'Pessoa já cadastrada neste perfil' });
        }
      } else {
        // Consulta o cadastro oficial completo no momento de gravar, não só os resultados visíveis.
        // Evita duplicar CPF/CNPJ ou nome que já exista fora do recorte de consulta.
        const registrosAtuais = await api.entities.Pessoa.list();
        const duplicados = localizarPessoaExistente(
          registrosAtuais,
          pessoaForm.nome,
          pessoaForm.documento
        );
        if (duplicados.length) {
          toast({
            variant: 'destructive',
            title: 'Possível cadastro já existente',
            description: 'Localize e selecione a pessoa acima. Não foi criado um duplicado.',
          });
          if (duplicados.length === 1) selecionarPessoa(duplicados[0]);
          return;
        }
        const criado = await api.entities.Pessoa.create(camposNovoPerfil(perfil, pessoaForm));
        cadastrado = { ...pessoaForm, ...criado };
        toast({ title: 'Pessoa salva no cadastro oficial' });
      }
      limparPessoa();
      await invalidateEntidade('Pessoa');
      await onReload?.();
      if (cadastrado?.id || cadastrado?.nome) {
        onCadastroConcluido?.({
          tipo: 'pessoa',
          perfil,
          id: cadastrado?.id || '',
          nome: cadastrado?.nome || pessoaForm.nome,
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível salvar a pessoa',
        description: String(err?.message || err),
      });
    } finally {
      setSalvandoPessoa(false);
    }
  }

  async function salvarVeiculo(event) {
    event.preventDefault();
    if (salvandoVeiculo) return;
    const placa = normalizarPlaca(veiculoForm.placa);
    if (placa.length !== 7) {
      toast({ variant: 'destructive', title: 'Informe uma placa válida de 7 caracteres.' });
      return;
    }

    setSalvandoVeiculo(true);
    try {
      // Veículo já cadastrado não é recriado nem alterado silenciosamente.
      const existentesAtuais = await api.entities.Veiculo.list();
      if (localizarVeiculoExistente(existentesAtuais, placa)) {
        await invalidateEntidade('Veiculo');
        toast({ title: 'Placa já cadastrada', description: 'O veículo existente está disponível para a pesagem.' });
        return;
      }
      const criado = await api.entities.Veiculo.create({
        placa,
        modelo: veiculoForm.modelo.trim(),
        motorista_id: veiculoForm.motorista_id || '',
        transportadora_id: veiculoForm.transportadora_id || '',
      });
      toast({ title: 'Veículo salvo no cadastro oficial' });
      setVeiculoForm(VEICULO_INICIAL);
      await invalidateEntidade('Veiculo');
      await onReload?.();
      onCadastroConcluido?.({
        tipo: 'veiculo',
        id: criado?.id || '',
        placa,
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível salvar o veículo',
        description: String(err?.message || err),
      });
    } finally {
      setSalvandoVeiculo(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">Preparação para a pesagem</h2>
          <p className="text-xs text-muted-foreground">
            Localize o cadastro existente ou registre só o que for novo. Nenhum ticket é aberto aqui.
          </p>
        </div>
        <Button onClick={onIrTickets} className="gap-2">
          Ir para Tickets <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-2">
        <Card className="min-w-0 p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2">
            <Contact className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Pessoas — cadastro oficial</h3>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PERFIS.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={perfil === item.id ? 'default' : 'outline'}
                  onClick={() => setPerfil(item.id)}
                  className="gap-1.5"
                >
                  <Icon className="h-3.5 w-3.5" /> {item.label}
                </Button>
              );
            })}
          </div>

          <div className="mb-3 space-y-1">
            <Label htmlFor="pesagem-busca-pessoa">Buscar antes de cadastrar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="pesagem-busca-pessoa"
                className="pl-9"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  if (/[A-Za-zÀ-ÿ]/.test(e.target.value) || !e.target.value.trim()) {
                    setPessoaForm((atual) => ({ ...atual, nome: e.target.value }));
                  }
                }}
                placeholder="Nome do motorista, fornecedor ou transportadora"
                disabled={loading || !!pessoaSelecionada}
              />
            </div>
            {busca.trim().length >= 2 && (
              <div className="max-h-44 overflow-y-auto rounded-md border">
                {candidatos.length ? candidatos.map((pessoa) => (
                  <button
                    type="button"
                    key={pessoa.id}
                    className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted"
                    onClick={() => selecionarPessoa(pessoa)}
                  >
                    <span className="min-w-0 truncate">{pessoa.nome}{pessoa.documento ? ' · ' + pessoa.documento : ''}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {pessoa[perfil] ? 'Cadastrado' : 'Usar e habilitar perfil'}
                    </span>
                  </button>
                )) : (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum cadastro encontrado.</p>
                )}
              </div>
            )}
          </div>

          <form onSubmit={salvarPessoa} className="space-y-2.5">
            {pessoaSelecionada ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{pessoaSelecionada.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {pessoaSelecionada[perfil] ? 'Perfil já ativo' : 'Cadastro existente — adicionar perfil sem duplicar'}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={limparPessoa}>Trocar</Button>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label htmlFor="pesagem-pessoa-nome">Nome / Razão social *</Label>
                  <Input
                    id="pesagem-pessoa-nome"
                    value={pessoaForm.nome}
                    onChange={(e) => setPessoaForm((atual) => ({ ...atual, nome: e.target.value }))}
                    placeholder="Nome completo"
                    required
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="pesagem-pessoa-doc">CPF / CNPJ</Label>
                    <Input
                      id="pesagem-pessoa-doc"
                      value={pessoaForm.documento}
                      onChange={(e) => setPessoaForm((atual) => ({ ...atual, documento: e.target.value }))}
                      placeholder="Documento (se disponível)"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pesagem-pessoa-tel">Telefone</Label>
                    <Input
                      id="pesagem-pessoa-tel"
                      value={pessoaForm.telefone}
                      onChange={(e) => setPessoaForm((atual) => ({ ...atual, telefone: e.target.value }))}
                      placeholder="Contato"
                    />
                  </div>
                </div>
                {perfil === 'is_motorista' && (
                  <div className="space-y-1">
                    <Label htmlFor="pesagem-pessoa-cnh">CNH</Label>
                    <Input
                      id="pesagem-pessoa-cnh"
                      value={pessoaForm.cnh}
                      onChange={(e) => setPessoaForm((atual) => ({ ...atual, cnh: e.target.value }))}
                      placeholder="Número da CNH (se disponível)"
                    />
                  </div>
                )}
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={limparPessoa}>Limpar</Button>
              <Button type="submit" disabled={salvandoPessoa || loading} size="sm">
                {salvandoPessoa ? 'Salvando...' : pessoaSelecionada ? 'Confirmar perfil' : 'Salvar pessoa'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="min-w-0 p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2">
            <Car className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Veículo — cadastro oficial</h3>
          </div>
          <form onSubmit={salvarVeiculo} className="space-y-2.5">
            <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div className="space-y-1">
                <Label htmlFor="pesagem-veiculo-placa">Placa *</Label>
                <Input
                  id="pesagem-veiculo-placa"
                  value={veiculoForm.placa}
                  onChange={(e) => setVeiculoForm((atual) => ({
                    ...atual,
                    placa: normalizarPlaca(e.target.value).slice(0, 7),
                  }))}
                  className="font-mono font-semibold"
                  placeholder="ABC1D23"
                  maxLength={7}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pesagem-veiculo-modelo">Modelo (opcional)</Label>
                <Input
                  id="pesagem-veiculo-modelo"
                  value={veiculoForm.modelo}
                  onChange={(e) => setVeiculoForm((atual) => ({ ...atual, modelo: e.target.value }))}
                  placeholder="Ex.: Scania"
                  disabled={!!veiculoExistente}
                />
              </div>
            </div>
            {veiculoExistente ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Placa já existente no cadastro. Não será duplicada nem alterada.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Motorista habitual (opcional)</Label>
                  <SearchSelect
                    value={veiculoForm.motorista_id}
                    onChange={(id) => setVeiculoForm((atual) => ({ ...atual, motorista_id: id }))}
                    options={motoristas.map((p) => ({ value: p.id, label: p.nome }))}
                    placeholder="Selecionar motorista"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Transportadora (opcional)</Label>
                  <SearchSelect
                    value={veiculoForm.transportadora_id}
                    onChange={(id) => setVeiculoForm((atual) => ({ ...atual, transportadora_id: id }))}
                    options={transportadoras.map((p) => ({ value: p.id, label: p.nome }))}
                    placeholder="Selecionar transportadora"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setVeiculoForm(VEICULO_INICIAL)}>Limpar</Button>
              <Button type="submit" size="sm" disabled={salvandoVeiculo || loading || !!veiculoExistente}>
                {salvandoVeiculo ? 'Salvando...' : veiculoExistente ? 'Já cadastrado' : 'Salvar veículo'}
              </Button>
            </div>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Para editar dados completos, utilize Cadastros &gt; Pessoas ou Cadastros &gt; Veículos.
            Os tickets continuam usando os mesmos registros.
          </p>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        Esta etapa não faz pesagem, movimentação de estoque nem altera tickets. O acesso segue as permissões do cadastro oficial.
      </p>
    </div>
  );
}
