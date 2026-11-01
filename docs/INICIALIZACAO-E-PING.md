# Inicialização após inatividade

Data: 01/11/2026.

## Diagnóstico e configuração

### Correção do agendador em 01/11/2026

O GitHub estava ativo, mas o histórico consultado apresentou somente a execução manual de 00:46 e uma execução agendada de 07:49 (horário de Brasília). Isso não manteve a API ativa a cada dez minutos. A execução manual bem-sucedida não era prova de pontualidade do cron.

O agendamento periódico foi transferido para `frontend/functions/keep-api-warm.mjs`, função agendada do Netlify a cada cinco minutos. `netlify.toml` define `functions` relativo ao base `frontend`. O workflow do GitHub fica disponível apenas para diagnóstico manual, evitando agendamentos duplicados.

A função usa destino HTTPS fixo, bloqueia redirects, aplica timeout de vinte segundos e valida o JSON de saúde. Não possui credenciais, entradas de usuário ou dependências adicionais. Na primeira partida a frio pode expirar enquanto o Render inicia; a próxima execução verifica novamente. Logs registram duração e sucesso/falha, sem tokens. A publicação em produção é necessária para ativar o schedule; execuções e horário seguinte devem ser confirmados em Netlify > Functions > keep-api-warm. Funções agendadas não podem ser invocadas por URL pública.

O agendamento consome a franquia de Functions do Netlify. Continua sujeito à disponibilidade e às quotas de Netlify/Render; não impede reinícios, deploys ou suspensão por limite mensal.

O texto abaixo descreve a configuração anterior do GitHub e suas limitações; o schedule nele citado foi substituído pela função Netlify.

Render Free suspende web services após 15 minutos sem tráfego de entrada. A próxima requisição inicia novamente a instância, processo que a documentação estima em cerca de um minuto. O frontend aguardava a restauração de sessão antes de mostrar as rotas, exibindo apenas “Carregando…”. O tempo relatado de 90 a 180 segundos é compatível com partida a frio, mas não houve acesso aos logs desse incidente para atribuir cada segundo a Render, Neon ou rede.

O Neon também suspende compute após cinco minutos de inatividade. Sua documentação descreve retomada rápida na próxima consulta. Pingar somente o banco não acordaria uma API Render suspensa. Manter o banco ativo continuamente aumenta consumo de compute sem demonstrar que resolveria a espera principal.

O workflow `.github/workflows/keep-api-warm.yml` faz GET HTTPS em `https://singledrive.onrender.com/health` a cada dez minutos, nos minutos 03, 13, 23, 33, 43 e 53. Também pode ser iniciado manualmente no GitHub Actions. Não depende do PC do operador, não utiliza secrets, não faz checkout e não possui permissões de escrita no GitHub.

`/health` responde somente com o estado do processo. O ping não consulta banco, login, Google Drive ou conteúdo de usuários. É necessário que GitHub Actions esteja habilitado e que o workflow esteja na branch padrão.

A tela inicial passa a explicar a espera após oito segundos e a demora prolongada após 90 segundos. Isso não elimina o tempo de inicialização: evita uma tela sem explicação. A lógica de restauração de sessão e os controles de segurança permanecem.

## Limitações operacionais

- GitHub pode atrasar ou descartar execuções agendadas durante períodos de carga. Portanto, dez minutos é o intervalo solicitado, não uma garantia de pontualidade.
- Em repositórios públicos, workflows agendados podem ser desativados após 60 dias sem atividade no repositório. Verificar Actions quando houver inatividade prolongada.
- Render oferece 750 horas gratuitas por workspace por mês. Uma instância ativa continuamente usa até 744 horas em um mês de 31 dias; outros serviços do mesmo workspace também consomem essa franquia. O ping não supera franquias, suspensões ou incidentes.
- Não foi contratado nem alterado plano pago. Para disponibilidade previsível em produção, a solução é uma instância sem suspensão por inatividade, com monitoramento e capacidade compatível com os uploads.
- O Neon continua podendo suspender por inatividade. Não adicionamos um loop de consultas artificiais ao banco.
- Para parar o ping, desabilitar o workflow “Manter API ativa” em GitHub Actions ou remover seu schedule.

## Fontes oficiais consultadas

- https://render.com/docs/free
- https://neon.com/docs/introduction/scale-to-zero
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://docs.netlify.com/build/functions/scheduled-functions/
