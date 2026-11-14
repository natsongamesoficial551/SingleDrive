# Publicar o frontend no Cloudflare Pages

Conecte apenas o repositório `natsongamesoficial551/SingleDrive` à conta Cloudflare e use:

- Branch de produção: `main`.
- Diretório raiz: `frontend`.
- Comando de build: `npm run build:cloudflare`.
- Diretório de saída: `dist`.
- Variável de build: `NODE_VERSION=22`.

O worker encaminha `/api/*` ao backend existente no Render, preservando corpos em streaming, cookies e redirecionamentos sem segui-los. As telas React usam fallback para `index.html` e recebem os cabeçalhos de segurança do frontend.

Antes de usar o novo domínio para login, configure `FRONTEND_URL` no backend com a origem Pages final. A configuração OAuth armazenada no backend deve continuar apontando para o callback do Render já autorizado no Google. O backend precisa ser publicado com a migração PostgreSQL `20261114000000_desktop_devices`; o Dockerfile PostgreSQL aplica as migrações automaticamente. Configure também os endereços fixos do desktop para a origem Pages final e gere novamente o executável.

Não colocar DATABASE_URL, JWT_ACCESS_SECRET, TOKEN_ENCRYPTION_KEY ou segredos Google nas variáveis de build do frontend. Esses valores pertencem apenas ao backend.
