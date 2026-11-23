# Vinculação do Discord

O caminho público é https://singledrive.pages.dev/discord. A pessoa entra com Google, confirma a conta no Discord e precisa estar no servidor. A API atribui **Seguindo** depois de validar as duas sessões. O aplicativo solicita apenas o escopo Discord `identify` e não envia o e-mail do SingleDrive ao Discord.

## Ativação

1. Em **OAuth2 → Redirects**, cadastre `https://singledrive.pages.dev/discord/callback` na aplicação do bot. Em **Bot**, habilite **Server Members Intent**.
2. No Render, adicione as variáveis abaixo ao serviço da API. Use os campos de ambiente do serviço para o token do bot e o Client Secret.
3. Garanta que o cargo do bot esteja acima de **Membros** e **Seguindo** e tenha **Gerenciar cargos**. Depois do deploy, teste a entrada de um membro e a vinculação pelo site.

| Variável | Valor |
| --- | --- |
| `DISCORD_CLIENT_ID` | `1553443707586482266` |
| `DISCORD_GUILD_ID` | `1574525541267144807` |
| `DISCORD_MEMBER_ROLE_ID` | `1574529104357629996` |
| `DISCORD_FOLLOWING_ROLE_ID` | `1574529102268858388` |
| `DISCORD_AUTO_MEMBER_ROLE` | `true` |
| `DISCORD_CLIENT_SECRET` | Client Secret da aplicação |
| `DISCORD_BOT_TOKEN` | Token do bot |

O worker de cargos acompanha novas entradas enquanto a API está ativa e reconcilia os membros quando se conecta ou reinicia.
