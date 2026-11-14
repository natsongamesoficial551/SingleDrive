# SingleDrive Backup para Windows — primeiro protótipo

Este projeto produz um aplicativo Windows que envia automaticamente arquivos de uma pasta local para a conta SingleDrive existente. O usuário entra com Google no navegador do sistema. O aplicativo não acessa o banco de dados diretamente.

## Executar

1. Compile com .NET SDK 8 no Windows:

   ```powershell
   dotnet run --project desktop/SingleDrive.Backup/SingleDrive.Backup.csproj
   ```

2. Informe a URL pública da API (por padrão, `https://singledrive.onrender.com`), clique em **Entrar com Google**, conclua o consentimento no navegador, escolha uma pasta e clique em **Iniciar backup**. O backend atualizado precisa estar publicado para reconhecer o cliente desktop.

Para gerar um `.exe` independente do runtime .NET instalado no PC:

```powershell
dotnet publish desktop/SingleDrive.Backup/SingleDrive.Backup.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o desktop/publish
```

O executável resultante fica em `desktop/publish/SingleDrive.Backup.exe`. O diretório `desktop/publish` é artefato local e não deve ser versionado.

## Comportamento e limites

- Faz uma varredura ao iniciar e outra a cada dois minutos. Arquivos modificados nos últimos cinco segundos aguardam a próxima varredura.
- Salva o catálogo de tamanho e data de modificação em `%LOCALAPPDATA%/SingleDrive/backup-state.json`. O cookie de renovação da sessão fica protegido por DPAPI para o usuário atual do Windows em `settings.json`; o token de acesso fica apenas em memória.
- Ignora links simbólicos e pontos de junção para não sair da pasta selecionada. Arquivos sem permissão de leitura são ignorados.
- Não apaga cópias remotas quando um arquivo local é excluído.
- Nesta versão, os arquivos são enviados para a raiz da biblioteca com o nome original. A estrutura de subpastas **não é preservada**. Arquivos homônimos de pastas diferentes podem aparecer como cópias com o mesmo nome.
- Modificações geram novos uploads; ainda não existe vínculo estável nem histórico de versões próprio. Não use este protótipo como única cópia de segurança.
- O envio atual usa multipart em uma requisição. Arquivos grandes ainda não contam com retomada automática; o endpoint retomável do backend será integrado na próxima etapa.
- O aplicativo só faz backup enquanto estiver aberto. Não há serviço, bandeja, início automático, restauração em lote ou instalador assinado nesta etapa.

## Próxima etapa

Criar no backend recursos de dispositivo, origem, item e versão de backup, além de finalização idempotente de upload. Em seguida, preservar caminhos relativos, retomar uploads e implementar restauração. O schema e as migrações precisam cobrir MySQL local e PostgreSQL de produção.
