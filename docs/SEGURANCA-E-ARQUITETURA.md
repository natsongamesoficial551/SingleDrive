# SingleDrive: seguranca e arquitetura para a nuvem

Pesquisa e avaliacao em 30 de outubro de 2026. Este documento descreve o estado
do codigo avaliado; nao representa uma auditoria completa ou garantia de seguranca.

## Falha de build

O build no Netlify foi interrompido por `frontend/scripts/check-deploy-env.cjs`:
`VITE_API_URL` nao foi definida. A verificacao e intencional: o frontend atual
depende de uma API HTTPS funcional. Configurar uma URL ficticia ou remover a
verificacao produziria uma interface publicada sem um backend funcional.

## Netlify e arquivos grandes

Netlify hospeda o frontend e oferece funcoes serverless para codigo no servidor.
O Express existente, suas conexoes Prisma e seus uploads em streaming nao se
transformam automaticamente em funcoes Netlify. A documentacao do Netlify lista
limite de 6 MB para payload de requisicao/resposta em buffer e limites proprios
para tempo de execucao e respostas em streaming. Nao presumir que o upload atual
de ate 5 GB atraves do servidor funcionara em funcoes Netlify. Uma arquitetura
alternativa exigiria estudar uploads diretos ou retomaveis ao Google Drive,
permissoes OAuth, restricoes CORS, exposicao e ciclo de vida dos tokens, alem de
validar arquivos grandes, falhas e tentativas reais antes de adota-la.

Fontes:
- https://docs.netlify.com/build/functions/overview/
- https://docs.netlify.com/build/functions/configuration/

## O que o Google Drive armazena

O Drive armazena os arquivos enviados. O banco MySQL atual guarda outros dados:
usuarios, sessoes, tokens de renovacao criptografados, configuracoes OAuth,
relacoes entre contas, arquivos, pastas virtuais e compartilhamentos. O Drive
nao e um banco MySQL compativel. Uma pasta `appDataFolder` pode guardar dados
privados do aplicativo em cada conta Google, mas utilizar esse recurso no lugar
do MySQL exige redesenhar autenticacao, indices, concorrencia, recuperacao,
revogacao e sincronizacao. E necessario decidir como localizar e proteger a
configuracao inicial e os vinculos entre varias contas antes de implementa-lo.
O armazenamento em Drive nao elimina automaticamente dados sensiveis nem o
servidor necessario a um fluxo seguro.

Fonte: https://developers.google.com/workspace/drive/api/guides/appdata

## Riscos identificados no codigo atual

1. As rotas em `backend/src/modules/system/system.routes.ts` anteriormente
   permitiam acesso a qualquer usuario autenticado. Agora exigem o UUID em
   `SYSTEM_ADMIN_USER_ID`, com acesso negado por padrao e teste de autorizacao.
   Ainda e necessario revisar a necessidade e seguranca de cada operacao.
2. O cadastro por email e senha ainda nao verifica a titularidade do email. O
   login Google agora exige email verificado e, para contas existentes, uma
   vinculacao previa ao mesmo identificador Google. A vinculacao foi coberta por
   testes de unidade; o fluxo completo OAuth e a recuperacao de contas existentes
   ainda precisam de validacao e uma estrategia de verificacao de email.
3. Os tokens de acesso e renovacao do aplicativo sao armazenados no navegador;
   scripts maliciosos executados na pagina podem acessa-los. Sao necessarias
   estrategias contra XSS e revisao da arquitetura de sessao. O app solicita
   acesso amplo ao Drive; minimizar escopos exige verificar compatibilidade com
   as funcionalidades existentes e os requisitos de verificacao do Google.
4. O projeto ainda requer revisao de isolamento de dados por usuario em todas as
   rotas, autorizacao de links publicos, concorrencia dos tokens de uso unico,
   limites de requisicao, monitoramento, vulnerabilidades de dependencias e
   procedimentos de backup, recuperacao e resposta a incidentes.

Essas observacoes sao pontos de partida; nao constituem uma lista exaustiva.
Nao expor o backend atual publicamente antes das correcoes e testes.

Fontes:
- https://owasp.org/Top10/2025/
- https://developers.google.com/identity/protocols/oauth2/resources/best-practices

## Sequencia tecnica

1. Definir uma arquitetura que atenda uploads grandes, autenticacao e dados de
   multiplas contas, inclusive a decisao de reimplementar ou manter o banco.
2. Isolar operacoes administrativas e corrigir criacao/vinculacao de usuarios.
3. Implementar a nova arquitetura com dados e credenciais de teste separados.
4. Testar autorizacao cruzada entre usuarios, OAuth, revogacao, uploads grandes,
   interrupcao e retomada, e revisar logs, dependencias e limites de servico.
5. Configurar enderecos HTTPS, segredos apenas no servidor, Google OAuth e
   `VITE_API_URL` com a API real. Validar antes de liberar para outras pessoas.
