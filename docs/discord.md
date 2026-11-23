# Vinculação do Discord

Há dois fluxos independentes:

- **Vincular Discord**, no menu lateral, confirma a participação no servidor e solicita ao SingleBot o cargo **Seguindo**. A página https://singledrive.pages.dev/discord também leva a esse fluxo.
- **Continuar com Discord**, na tela de entrada, pode criar um perfil a partir de um e-mail verificado no Discord. Para usar o mesmo perfil de um cadastro já existente, entre pelo método original e habilite **Configurações → Login com Discord**. Nenhum dos dois passos depende do servidor.

A verificação da comunidade solicita apenas `identify`. O login solicita `identify email` para verificar a identidade e obter o e-mail de um perfil novo.

## Ativação

1. Em **OAuth2 → Redirects**, cadastre `https://singledrive.pages.dev/discord/callback` na aplicação do bot. Em **Bot**, habilite **Server Members Intent**.
2. No Render, adicione as variáveis abaixo ao serviço da API. Use os campos de ambiente do serviço para o token do bot e o Client Secret.
3. Garanta que o cargo do bot esteja acima de **Membros** e **Seguindo** e tenha **Gerenciar cargos**. Depois do deploy, teste a entrada de um membro e a vinculação pelo site.

| Variável | Valor |
| --- | --- |
| `DISCORD_CLIENT_ID` | `1574532255739674697` |
| `DISCORD_GUILD_ID` | `1574525541267144807` |
| `DISCORD_MEMBER_ROLE_ID` | `1574529104357629996` |
| `DISCORD_FOLLOWING_ROLE_ID` | `1574529102268858388` |
| `DISCORD_AUTO_MEMBER_ROLE` | `true` |
| `DISCORD_CLIENT_SECRET` | Client Secret da aplicação |
| `DISCORD_BOT_TOKEN` | Token do bot |

O worker de cargos acompanha novas entradas enquanto a API está ativa e reconcilia os membros quando se conecta ou reinicia.
