# Estabilidade de sessão e atualização de armazenamento

Data: 31/10/2026. Escopo: deslogamentos, conexão de múltiplos Drives e cotas desatualizadas.

## Diagnóstico

- O limite de 60 chamadas a `/auth` em 15 minutos também contava consultas `/auth/me` e rotações `/auth/refresh`. O uso normal e popups podiam consumir o orçamento de login. Atrás de proxies, uma identificação incorreta de IP pode agravar o compartilhamento desse limite.
- A renovação apagava a sessão local em qualquer erro, inclusive rede, 429 e 503.
- A deduplicação de refresh existia apenas dentro de uma aba. Abas e popups compartilham o cookie e podiam disputar a rotação de uso único.
- O evento de mudança de armazenamento atualizava estatísticas, mas não a lista de contas do layout. As cotas do provedor também não eram renovadas automaticamente quando antigas.
- O botão de atualização de cotas apenas relia o banco; não solicitava sincronização dos provedores.

## Alterações

1. Separação de limites de senha e entrada/conclusão OAuth. Consultas de sessão e rotações válidas não consomem tentativas de login. As proteções de 10 tentativas por conta e 60 por IP em 15 minutos permanecem para senha, contando falhas. OAuth mantém limite próprio de 60 chamadas por IP em 15 minutos. A conexão autenticada continua exigindo usuário e sessão válidos.
2. Erros temporários preservam o acesso local; apenas refresh rejeitado com 401 encerra a sessão. Na inicialização, uma indisponibilidade mostra mensagem e botão de nova tentativa. Respostas 429 exibem o prazo informado pelo servidor.
3. Web Locks serializa o refresh entre abas e popups no Chrome e outros navegadores compatíveis. O refresh continua rotacionando no servidor, com cookie HttpOnly/Secure e verificação de Origin. Navegadores sem Web Locks mantêm somente a deduplicação por aba; concorrência entre abas nesses navegadores é uma limitação.
4. Uma renovação que retorna identidade diferente da aba não repete a operação como o outro usuário. Conectar vários Drives é diferente de abrir sessões de usuários SingleDrive diferentes: cookies são compartilhados entre abas da mesma origem.
5. Contas e estatísticas atualizam após conexão, retorno à aba e a cada 60 segundos enquanto ela está visível. BroadcastChannel complementa postMessage quando o Google separa o popup do opener. Nenhuma credencial trafega nesse canal.
6. Cotas Google com mais de 60 segundos são sincronizadas ao consultar contas/resumo; chamadas simultâneas compartilham a consulta por conta dentro do mesmo processo, com até três contas por lote. Falhas preservam o snapshot anterior. A consulta de quota Google possui timeout de oito segundos. Várias instâncias ainda podem consultar a mesma conta simultaneamente.
7. O botão Atualizar consulta as contas nos provedores e atualiza a interface. Cotas S3 existentes só são recalculadas explicitamente, evitando listagem de todo o bucket a cada minuto.

## Verificação

- Seis testes do cliente: falhas de rede/429/503; refresh 401; OAuth 401 sem apagar a sessão; deduplicação na aba; serialização entre abas/popup; recusa de mudança implícita de identidade.
- 23 testes HTTP com PostgreSQL 17.6 local descartável e serviços Google simulados. Incluem quatro contas em modo completo, 65 consultas de sessão, 65 rotações de refresh, 15 logins válidos, sincronização de quatro cotas, deduplicação e isolamento entre usuários.
- Build TypeScript do backend e build de produção do frontend executados.
- Os testes mantêm a recusa de verifier errado, estado reutilizado, sessão alheia, origem externa, escopo indevido, usuário suspenso e acesso administrativo indevido.

## Limites e pendências

Não houve nesta correção validação do consentimento Google real com quatro contas no navegador. Os testes locais não comprovam configuração privada do Render, identificação de IP por toda a cadeia de proxies ou revogação das ACLs Google antigas. Render gratuito pode demorar a acordar após inatividade; isso não é uma revogação de sessão.

Os achados anteriores sobre memória/erros em streaming, defaults Docker e o bug de compartilhamento que envia arquivo à lixeira permanecem fora deste patch. Não afirmar que toda a auditoria de segurança foi resolvida por esta alteração.
