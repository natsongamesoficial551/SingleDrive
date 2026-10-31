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
Defina `VITE_API_URL` como a URL HTTPS do backend, sem barra final. O build
falha quando ela nao estiver configurada ou apontar para localhost.
Credenciais nunca devem ser configuradas em variaveis `VITE_*`, pois o Vite
as inclui no codigo entregue aos navegadores.

## Backend e banco

O backend de nuvem requer Node.js, Prisma e PostgreSQL. O arquivo
`backend/Dockerfile.postgres` usa o esquema e a migracao de base vazia em
`backend/prisma-postgres`, independentes do MySQL local em `backend/prisma`.
Alteracoes futuras no modelo devem ser aplicadas e migradas nos dois esquemas.
A compatibilidade ainda precisa ser testada com um banco PostgreSQL real; a
migracao inicial nao copia os dados MySQL. O arquivo `docs/render-exemplo.yaml`
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
