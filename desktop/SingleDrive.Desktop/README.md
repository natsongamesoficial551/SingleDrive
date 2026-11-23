# SingleDrive Desktop

Executável Windows que abre a interface completa do SingleDrive em uma janela de aplicativo do Microsoft Edge. Usa o site publicado em `https://singledrive.pages.dev/` e, portanto, as mesmas contas, APIs, arquivos e banco de dados já usados pelo site. O `.exe` não contém URL do banco, senha, segredo OAuth, chave de API ou token de usuário.

## Compilar

```powershell
dotnet publish desktop/SingleDrive.Desktop/SingleDrive.Desktop.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o desktop/SingleDrive.Desktop/publish
```

Abra `desktop/SingleDrive.Desktop/publish/SingleDrive.Desktop.exe`. É necessário ter Microsoft Edge instalado e acesso ao site pela internet. O login Google ocorre no navegador real, com a mesma sessão do perfil Edge do usuário.

O executável mantém o agente de backup na bandeja. Na tela **Computadores**, use **Abrir agente do SingleDrive**, entre com Google no agente e escolha a pasta local. O agente registra o PC no backend e permite pausar, retomar e revogar o vínculo pelo site. O início automático no Windows é opcional.

A sessão e o catálogo local são protegidos por DPAPI. A conta aceita até dez vínculos ativos. O catálogo remoto guarda caminhos e metadados criptografados com AES-256-GCM para permitir a restauração após formatar. O backup mantém a árvore de pastas no SingleDrive e no Google Drive. Use Restaurar backup no agente para escolher a origem e confirmar o destino sugerido para o Windows atual. Arquivos existentes são preservados, e os downloads são verificados por tamanho e SHA-256. Ainda não há interface de histórico de versões ou retomada de upload. Consulte o README da pasta desktop para o procedimento completo e as limitações.

Antes de usar o vínculo em produção, publique o backend e aplique as migrações `20261114000000_desktop_devices` e `20261114010000_backup_catalog` usando o schema correspondente ao banco (PostgreSQL no Neon ou MySQL local). Publique também o frontend atualizado. O Dockerfile PostgreSQL já executa `prisma migrate deploy` antes de iniciar a API.
