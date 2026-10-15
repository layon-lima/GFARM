import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  LockKeyhole,
  Monitor,
  MonitorSmartphone,
  PackageMinus,
  PackagePlus,
  Save,
  Smartphone,
  UserRound,
  Warehouse,
} from 'lucide-react';

import { api } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAGES } from '@/lib/permissions';

const MOBILE_ACTIONS = [
  {
    key: 'baixar',
    label: 'Dar baixa',
    description: 'Realizar uma saída real do saldo selecionado.',
    icon: PackageMinus,
  },
  {
    key: 'mudar_gaveta',
    label: 'Mudar gaveta',
    description: 'Mover saldo entre gavetas do mesmo depósito.',
    icon: ArrowRightLeft,
  },
  {
    key: 'mudar_deposito',
    label: 'Mudar depósito',
    description: 'Mover saldo para outro depósito e outra gaveta.',
    icon: Warehouse,
  },
];

function PermissionItem({ checked, onChange, icon: Icon, title, description }) {
  return (
    <label className="flex min-h-[68px] cursor-pointer items-start gap-3 rounded-xl border bg-background p-3.5 transition-colors hover:border-primary/30 hover:bg-primary/[0.025]">
      <Checkbox checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      {Icon ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <span className="min-w-0">
        <strong className="block text-sm font-semibold">{title}</strong>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function PermissionSection({ icon: Icon, eyebrow, title, description, badge, children }) {
  return (
    <Card className="overflow-hidden rounded-2xl border shadow-none">
      <div className="flex items-start justify-between gap-4 border-b bg-muted/20 px-5 py-4">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">
              {eyebrow}
            </p>
            <h2 className="mt-0.5 text-base font-semibold">{title}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        {badge ? (
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

export default function UsuarioPermissoes() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const [user, setUser] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [role, setRole] = useState('user');
  const [adminPermissoes, setAdminPermissoes] = useState([]);
  const [setores, setSetores] = useState([]);
  const [paginas, setPaginas] = useState([]);
  const [setoresSel, setSetoresSel] = useState([]);
  const [acoesMobile, setAcoesMobile] = useState([]);
  const [podeDigitarPeso, setPodeDigitarPeso] = useState(false);
  const [podeConfirmarAbastecimento, setPodeConfirmarAbastecimento] = useState(false);
  const [podeAbastecerSemFoto, setPodeAbastecerSemFoto] = useState(false);
  const [podeEntradaManualSaldoMobile, setPodeEntradaManualSaldoMobile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const voltar = () => navigate('/cadastros?tab=usuarios');

  useEffect(() => {
    let active = true;

    const carregarUsuario = async () => {
      if (typeof api.entities.User.get === 'function') {
        try {
          return await api.entities.User.get(userId);
        } catch {
          // Compatibilidade com o backend que ainda pode estar executando a
          // versão anterior, sem a rota de consulta individual.
        }
      }

      const usuarios = await api.entities.User.list();
      const encontrado = usuarios.find((item) => item.id === userId);

      if (!encontrado) {
        throw new Error('Usuário não encontrado.');
      }

      return encontrado;
    };

    Promise.all([
      carregarUsuario(),
      api.entities.Setor.list(),
      api.entities.User.permissionsCatalog(),
    ])
      .then(([usuario, listaSetores, permissionCatalog]) => {
        if (!active) return;

        const ordenados = [...(listaSetores || [])].sort((a, b) =>
          String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', {
            sensitivity: 'base',
          })
        );

        setUser(usuario);
        setCatalog(permissionCatalog);
        setRole(usuario.role || 'user');
        setAdminPermissoes(
          Array.isArray(usuario.permissoes)
            ? usuario.permissoes.filter((key) => key.startsWith('admin.'))
            : []
        );
        setSetores(ordenados);
        setPaginas(Array.isArray(usuario.paginas_permitidas) ? usuario.paginas_permitidas : []);
        setSetoresSel(Array.isArray(usuario.setores_permitidos) ? usuario.setores_permitidos : []);
        setPodeDigitarPeso(usuario.pode_digitar_peso === true);
        setPodeConfirmarAbastecimento(usuario.pode_confirmar_abastecimento === true);
        setPodeAbastecerSemFoto(
          Array.isArray(usuario.permissoes)
          && usuario.permissoes.includes(
            'operacao.abastecimento.sem_foto'
          )
        );
        setPodeEntradaManualSaldoMobile(usuario.pode_entrada_manual_saldo_mobile === true);
        setAcoesMobile([
          usuario.pode_baixar_mobile ? 'baixar' : null,
          usuario.pode_mudar_gaveta_mobile ? 'mudar_gaveta' : null,
          usuario.pode_mudar_deposito_mobile ? 'mudar_deposito' : null,
        ].filter(Boolean));
      })
      .catch((error) => {
        if (!active) return;
        toast({
          variant: 'destructive',
          title: 'Não foi possível abrir as permissões',
          description: error?.message,
        });
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [toast, userId]);

  const setoresValidos = useMemo(() => {
    const ids = new Set(setores.map((setor) => setor.id));
    return setoresSel.filter((id) => ids.has(id));
  }, [setores, setoresSel]);

  const toggleList = (setter, key) => {
    setter((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    try {
      const permissoes = role === 'admin'
        ? []
        : [
            ...paginas.map((pagina) => `page.${pagina}`),
            podeDigitarPeso
              ? 'operacao.pesagem.digitar_peso'
              : null,
            podeConfirmarAbastecimento
              ? 'operacao.abastecimento.confirmar'
              : null,
            podeAbastecerSemFoto
              ? 'operacao.abastecimento.sem_foto'
              : null,
            acoesMobile.includes('baixar')
              ? 'mobile.estoque.baixar'
              : null,
            acoesMobile.includes('mudar_gaveta')
              ? 'mobile.estoque.mudar_gaveta'
              : null,
            acoesMobile.includes('mudar_deposito')
              ? 'mobile.estoque.mudar_deposito'
              : null,
            podeEntradaManualSaldoMobile
              ? 'mobile.estoque.entrada_manual_saldo'
              : null,
            ...(role === 'subadmin' ? adminPermissoes : []),
          ].filter(Boolean);

      await api.entities.User.updatePermissions(
        user.id,
        {
          role,
          permissoes,
          setores_permitidos:
            role === 'admin'
              ? []
              : setoresValidos,
        }
      );

      toast({
        title: 'Permissões atualizadas',
        description: `Os acessos de ${user.display_name || user.username} foram salvos.`,
      });
      voltar();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar',
        description: error?.message || 'Não foi possível atualizar as permissões.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (currentUser?.role !== 'admin') {
    return (
      <Navigate
        to="/cadastros?tab=usuarios"
        replace
      />
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <h1 className="text-xl font-semibold">Usuário não encontrado</h1>
        <Button variant="outline" className="mt-4" onClick={voltar}>Voltar aos usuários</Button>
      </div>
    );
  }

  const nome = user.display_name || user.username || 'Usuário';
  const adminItems = (catalog?.permissions || []).filter(
    (item) => item.group === 'administracao'
  );

  return (
    <div className="w-full min-w-0 space-y-3 px-3 py-3 lg:px-4 xl:px-5">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Button variant="outline" size="icon" onClick={voltar} title="Voltar aos usuários">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserRound className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Controle de acesso</p>
            <h1 className="truncate text-xl font-semibold">Permissões de {nome}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {user.username} · As alterações valem no computador e no celular conforme cada grupo.
            </p>
          </div>
        </div>
        <div className="flex gap-2 sm:shrink-0">
          <Button variant="outline" onClick={voltar} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar permissões
          </Button>
        </div>
      </div>

      <PermissionSection
        icon={LockKeyhole}
        eyebrow="Perfil e administração"
        title="Perfil do usuário"
        description="Administrador Total possui acesso irrestrito. Sub Administrador recebe somente as funções administrativas marcadas abaixo."
        badge={
          role === 'admin'
            ? 'Acesso total'
            : role === 'subadmin'
              ? 'Sub Administrador'
              : 'Usuário'
        }
      >
        <div className="mb-4 max-w-sm">
          <label className="mb-1.5 block text-xs font-medium">
            Perfil
          </label>
          <Select
            value={role}
            onValueChange={(novoRole) => {
              setRole(novoRole);
              if (novoRole !== 'subadmin') {
                setAdminPermissoes([]);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">
                Usuário
              </SelectItem>
              <SelectItem value="subadmin">
                Sub Administrador
              </SelectItem>
              <SelectItem value="admin">
                Administrador Total
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {role === 'admin' ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            Este perfil ignora a matriz granular e possui acesso total ao sistema.
          </div>
        ) : role === 'subadmin' ? (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {adminItems.map((item) => (
              <PermissionItem
                key={item.key}
                checked={adminPermissoes.includes(item.key)}
                onChange={() =>
                  toggleList(setAdminPermissoes, item.key)
                }
                title={item.label}
                description={item.description}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Usuários padrão não recebem funções administrativas.
          </div>
        )}
      </PermissionSection>

      {role !== 'admin' ? (
        <>
      <PermissionSection
        icon={MonitorSmartphone}
        eyebrow="Computador e celular"
        title="Áreas do sistema"
        description="Define quais módulos este usuário pode abrir, independentemente do dispositivo usado."
        badge={`${paginas.length}/${PAGES.length}`}
      >
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {PAGES.map((pagina) => (
            <PermissionItem
              key={pagina.key}
              checked={paginas.includes(pagina.key)}
              onChange={() => toggleList(setPaginas, pagina.key)}
              title={pagina.label}
              description="Acesso ao módulo"
            />
          ))}
        </div>
      </PermissionSection>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <PermissionSection
          icon={Monitor}
          eyebrow="Operação"
          title="Permissões operacionais"
          description="Permissões específicas para rotinas de abastecimento e pesagem."
        >
          <div className="grid gap-2.5">
            <PermissionItem
              checked={podeDigitarPeso}
              onChange={setPodeDigitarPeso}
              icon={ClipboardCheck}
              title="Digitar peso manualmente"
              description="Permite informar o peso dos tickets sem usar apenas a balança."
            />
            <PermissionItem
              checked={podeConfirmarAbastecimento}
              onChange={setPodeConfirmarAbastecimento}
              icon={CheckCircle2}
              title="Confirmar abastecimentos"
              description="Permite conferir a foto e confirmar a baixa do abastecimento."
            />
            <PermissionItem
              checked={podeAbastecerSemFoto}
              onChange={setPodeAbastecerSemFoto}
              icon={CheckCircle2}
              title="Abastecimento sem foto obrigatória"
              description="Permite registrar abastecimento sem tirar a foto do painel do abastecedor."
            />
          </div>
        </PermissionSection>

        <PermissionSection
          icon={Smartphone}
          eyebrow="Somente celular"
          title="Ações ao segurar um produto"
          description="Controla as opções disponíveis no menu de ações rápidas do mobile."
          badge={`${acoesMobile.length}/${MOBILE_ACTIONS.length}`}
        >
          <div className="grid gap-2.5">
            {MOBILE_ACTIONS.map((action) => (
              <PermissionItem
                key={action.key}
                checked={acoesMobile.includes(action.key)}
                onChange={() => toggleList(setAcoesMobile, action.key)}
                icon={action.icon}
                title={action.label}
                description={action.description}
              />
            ))}
          </div>
        </PermissionSection>
      </div>

      <PermissionSection
        icon={PackagePlus}
        eyebrow="Somente celular"
        title="Entrada Manual de Saldo"
        description="Libera no celular a página para enviar produto, quantidade e localização para revisão do administrador. O usuário não altera o estoque diretamente."
        badge={podeEntradaManualSaldoMobile ? 'Liberado' : 'Bloqueado'}
      >
        <PermissionItem
          checked={podeEntradaManualSaldoMobile}
          onChange={setPodeEntradaManualSaldoMobile}
          icon={PackagePlus}
          title="Permitir Entrada Manual de Saldo"
          description="Exibe o card de acesso rápido no mobile e permite enviar solicitações para aprovação no computador."
        />
      </PermissionSection>

      <PermissionSection
        icon={Warehouse}
        eyebrow="Somente celular"
        title="Setores exibidos no mobile"
        description="Escolha os setores que aparecem na página inicial e na barra inferior do celular."
        badge={`${setoresValidos.length}/${setores.length}`}
      >
        <div className="mb-4 flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setSetoresSel(setores.map((setor) => setor.id))}>
            Marcar todos
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSetoresSel([])}>
            Limpar seleção
          </Button>
        </div>
        {setores.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum setor cadastrado.
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {setores.map((setor) => (
              <label key={setor.id} className="flex cursor-pointer items-center gap-3 rounded-xl border bg-background p-3.5 hover:border-primary/30">
                <Checkbox checked={setoresSel.includes(setor.id)} onCheckedChange={() => toggleList(setSetoresSel, setor.id)} />
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: setor.cor || '#16a34a' }} />
                <strong className="min-w-0 truncate text-sm font-medium">{setor.nome}</strong>
              </label>
            ))}
          </div>
        )}
      </PermissionSection>

        </>
      ) : null}

      <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><LockKeyhole className="h-4 w-4" /> A matriz inteira é salva em um único banco de permissões.</span>
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}
