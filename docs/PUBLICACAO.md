# Publicacao do SingleDrive

O frontend pode ser construido pelo Netlify a partir do repositorio. O backend
Express e o banco MySQL exigem hospedagem separada e persistente. O Netlify nao
fornece um servidor MySQL compativel com o esquema atual da aplicacao.

## Estado atual

Este projeto ainda nao esta pronto para uso publico. A API oferece funcoes de
administracao global em `/system` a qualquer usuario autenticado, incluindo
alteracao da configuracao OAuth. A autenticacao e o isolamento entre usuarios
devem passar por revisao e testes de seguranca antes da implantacao publica.
Nao exponha o backend na internet ate corrigir e validar esses pontos.

## Frontend no Netlify

O arquivo `netlify.toml` configura o build e o redirecionamento de rotas React.
Defina `VITE_API_URL` como a URL HTTPS do backend, sem barra final. O build
falha quando ela nao estiver configurada ou apontar para localhost.
Credenciais nunca devem ser configuradas em variaveis `VITE_*`, pois o Vite
as inclui no codigo entregue aos navegadores.

## Backend e banco

O backend requer Node.js, Prisma e MySQL compativel com as migracoes em
`backend/prisma/migrations`. Use um provedor que suporte conexoes MySQL,
armazenamento persistente e uploads em streaming. `APP_HOST=0.0.0.0` permite
receber conexoes no container; o padrao continua `127.0.0.1` para uso local.
Configure `APP_PORT`, `FRONTEND_URL`, `DATABASE_URL`, `JWT_ACCESS_SECRET` e
`TOKEN_ENCRYPTION_KEY` no ambiente privado do backend. Nao reutilize exemplos
como segredos de producao e nunca os envie ao repositorio.

Uma instalacao nova inicia com banco vazio: contas e conexoes locais nao sao
automaticamente copiadas. Migrar dados ou segredos exige procedimento proprio.
Configure tambem o cliente OAuth e os enderecos de retorno HTTPS no Google Cloud;
em modo de teste, somente os usuarios de teste autorizados podem entrar.
O acesso amplo ao Drive pode exigir verificacao do aplicativo pelo Google.

O projeto deriva do 9Drive de zenhosta. Preserve o arquivo `LICENSE` e os
avisos de direitos autorais aplicaveis na redistribuicao.
