# Publicacao do SingleDrive

O frontend pode ser construido pelo Netlify a partir do repositorio. A arquitetura
em preparacao usa API gratuita no Render e PostgreSQL Neon atraves da integracao
do Netlify. O MySQL permanece em uso somente na instalacao local existente.

## Estado atual

Este projeto ainda nao esta pronto para uso publico. As rotas de administracao
global em `/system` exigem agora que `SYSTEM_ADMIN_USER_ID` corresponda ao ID do
usuario autenticado; sem essa variavel, nenhum usuario acessa essas rotas. O
login Google exige email verificado e vinculacao previa ao usuario existente.
A autenticacao e o isolamento entre usuarios ainda precisam de revisao e testes
adicionais antes da implantacao publica. Nao exponha o backend ate valida-los.

## Frontend no Netlify

O arquivo `netlify.toml` configura o build e o redirecionamento de rotas React.
O frontend de produção usa `/api` na mesma origem, encaminhado pelo proxy
definido em `netlify.toml`. `VITE_API_URL` serve ao desenvolvimento. Confirme que
`/api/health` retorna JSON do backend, nunca o fallback HTML do React.
Credenciais nunca devem ser configuradas em variaveis `VITE_*`, pois o Vite
as inclui no codigo entregue aos navegadores.

## Backend e banco

O backend de nuvem requer Node.js, Prisma e PostgreSQL. O arquivo
`backend/Dockerfile.postgres` usa o esquema e a migracao de base vazia em
`backend/prisma-postgres`, independentes do MySQL local em `backend/prisma`.
Alterações no modelo devem ser aplicadas e migradas nos dois esquemas.
A suíte de segurança e a migração foram testadas em PostgreSQL 17.6 local e
MariaDB 11.4.5 local. Isso não valida a configuração da hospedagem nem substitui
o teste Google real. A migração inicial não copia dados MySQL. O arquivo `docs/render-exemplo.yaml`
documenta um servico Render gratuito, mas ainda nao realiza uma implantacao.
`APP_HOST=0.0.0.0` permite
receber conexoes no container; o padrao continua `127.0.0.1` para uso local.
Configure `FRONTEND_URL`, `DATABASE_URL`, `JWT_ACCESS_SECRET` e
`TOKEN_ENCRYPTION_KEY` no ambiente privado do backend. Nao reutilize exemplos
como segredos de producao e nunca os envie ao repositorio.
O backend usa `APP_PORT`, depois `PORT`, ou 4000 se nenhuma estiver definida.
Para habilitar as rotas administrativas, configure `SYSTEM_ADMIN_USER_ID` com
o UUID de um administrador escolhido e autenticado; configure-o somente no
backend. Na instalacao local, as rotas tambem ficam desativadas se ele faltar.

Uma instalacao nova inicia com banco vazio: contas e conexoes locais nao sao
automaticamente copiadas. Migrar dados ou segredos exige procedimento proprio.
Configure tambem o cliente OAuth e os enderecos de retorno HTTPS no Google Cloud;
em modo de teste, somente os usuarios de teste autorizados podem entrar.
O acesso amplo ao Drive pode exigir verificacao do aplicativo pelo Google.

O projeto deriva do 9Drive de zenhosta. Preserve o arquivo `LICENSE` e os
avisos de direitos autorais aplicaveis na redistribuicao.

O Render Free desliga o servidor depois de 15 minutos ociosos e pode demorar
aproximadamente um minuto para reativa-lo; usa ate 750 horas gratuitas por mes
por workspace. Confirme os limites e termos vigentes antes de criar servicos.
O Render Postgres Free expira apos 30 dias; nao e o banco escolhido aqui.
Fontes: https://render.com/docs/free e https://neon.com/pricing

## Atualização de segurança de 31/10/2026

O login Google passa a pedir somente `openid email profile`. A conexão ao Drive
é separada, em Configurações, com duas opções:

- **Essencial**, padrão: `drive.file`, para enviar, abrir, renomear, mover e apagar
  arquivos criados pelo aplicativo ou autorizados individualmente a ele. Arquivos
  preexistentes fora desse conjunto ficam inacessíveis. A interface não contém
  Google Picker para selecionar arquivos antigos.
- **Completo**: `drive`, para gerenciar todo o Drive autorizado, mediante escolha
  explícita. O alcance aumenta o impacto de um comprometimento do aplicativo.

A seleção vale para a conexão seguinte. Para reduzir o alcance, revogue a
autorização anterior na Conta Google e reconecte. O backend recusa grants mais
amplos que o escolhido. Configure os escopos e o redirect URI exato no Google
Cloud; não use curingas. O fluxo exige PKCE e a sessão que iniciou a conexão.

### Migração e recuperação

Antes de publicar, faça backup privado do banco e preserve `TOKEN_ENCRYPTION_KEY`
no gerenciador de segredos. Trocar essa chave sem recifrar os dados torna tokens
ilegíveis. Suspenda tráfego durante a atualização conjunta de frontend e backend;
o contrato antigo de autenticação deixa de ser compatível.

A migração `20261031210000_security_identity_boundary` existe nas duas variantes.
Preserva arquivos e tokens Google criptografados para auditoria; revoga sessões
e API keys; desabilita links SingleDrive; apaga estados OAuth/handoffs/previews
antigos. Conexões ativas passam para revisão. Contas ativas com conexão Google
ativa também ficam em revisão; usuários suspensos continuam suspensos.

A recuperação Google exige e-mail verificado e o mesmo `sub` do vínculo legado.
Não reativa os tokens Google antigos: cada conta precisa reconectar o Drive.
Vincular uma identidade Google com o mesmo e-mail de um cadastro local passa a
exigir login Google; o login por senha desse cadastro fica desativado.
Coincidência de e-mail sozinha não permite recuperação. Casos sem prova de vínculo
exigem atendimento com verificação de titularidade.

Instale dependências e execute no backend:

```powershell
# MySQL
npm run prisma:generate
npm run db:migrate:deploy
npm run build

# PostgreSQL fora do container
npx prisma generate --schema=prisma-postgres/schema.prisma
npx prisma migrate deploy --schema=prisma-postgres/schema.prisma
npm run build
```

O `Dockerfile.postgres` copia a variante PostgreSQL para `prisma` no container.
Não execute reset ou `migrate dev` em produção. Evite rollback ao código antigo,
que volta a criar permissões públicas; prefira corrigir para a frente, mantendo
sessões e credenciais antigas revogadas.

### Permissões públicas já existentes

A versão antiga podia criar ACL `anyone/writer` no Google em uploads e ao copiar
links. O patch impede novas concessões, mas não remove as antigas. Audite cada
conta no ambiente privado do backend:

```powershell
npm run audit:google-public-permissions -- --user UUID_DO_DONO --account UUID_DA_CONTA
```

Sem `--apply`, o comando apenas consulta. Após revisar os IDs, acrescentar
`--apply` remove permissões `anyone` dos arquivos/pastas registrados no banco,
inclusive compartilhamentos públicos intencionais. A ferramenta não cobre
arquivos órfãos, cópias externas nem todo o Drive; herança e erros exigem revisão
no Google. Guarde a saída em local privado. Não foi executada em produção.

### Verificações para liberar tráfego

1. Confirme repositório, branch, Dockerfile, banco e revisão nos consoles de
   hospedagem. Arquivos de exemplo não comprovam o vínculo com o serviço real.
2. Valide `/api/health`, CSP, nosniff, ausência de cache e cookie
   `HttpOnly; Secure`. Confirme o `FRONTEND_URL` HTTPS exato.
3. Com duas contas Google controladas, teste login, Essencial/Completo, redução
   de escopo, desconexão e revogação na Conta Google.
4. Teste upload normal/resumível, abrir, mover, renomear e apagar um arquivo
   descartável. No Essencial, um arquivo antigo não autorizado deve ser negado.
5. Tente acessar IDs da conta A como B; valide links revogados, conta suspensa e
   API key revogada. Confirme no Google que uploads privados não têm ACL `anyone`.
6. Refaça o inventário de ACLs antigas e registre remoções e pendências.

`TRUST_PROXY_HOPS` tem padrão zero. Só configure após verificar a cadeia e o
tratamento de `X-Forwarded-For` na hospedagem. Contagem errada pode permitir IP
falso; zero atrás de proxy pode agrupar usuários no limite de autenticação.
Netlify (`public/_headers`) e nginx incluem os cabeçalhos da versão corrigida.
Testes locais não comprovam implantação nem ausência absoluta de risco.
