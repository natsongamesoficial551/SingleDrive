# SingleDrive Desktop para Windows

Aplicativo .NET 8 com site em janela e agente de backup na bandeja. Usa a mesma conta Google e as mesmas APIs do site. Não distribui credenciais do banco ou segredos OAuth.

## Compilar e testar

```powershell
dotnet publish desktop/SingleDrive.Desktop/SingleDrive.Desktop.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o desktop/SingleDrive.Desktop/publish/v0.3.0
dotnet run --project desktop/SingleDrive.PathTests/SingleDrive.PathTests.csproj
```

Execute SingleDrive.Desktop.exe, abra o agente, entre com Google e selecione a pasta. Backend atualizado e migrações aplicadas são necessários. API de produção: https://singledrive.pages.dev/api/.

## Vínculo e organização

- Até cinco vínculos ativos por conta. Sessões revogadas/expiradas liberam vagas. Após formatar, revogue o PC antigo no site; o catálogo permanece na conta.
- Estrutura no Drive e no site: `9drive/Backups de PCs/Computador - identificador/Pasta - identificador/subpastas`. Identificadores curtos distinguem origens homônimas.
- Upload envia o folderId correto. A árvore usa uma conta Google; falta de espaço causa falha e nova tentativa, sem troca silenciosa de conta.
- Varredura inicial e a cada dois minutos. Arquivos alterados nos últimos cinco segundos aguardam. Pastas vazias e arquivos vazios também ficam no catálogo; pastas são criadas no Drive, arquivos vazios são recriados na restauração.
- Catálogo remoto com caminhos, origem e SHA-256 criptografados com AES-256-GCM. Catálogo local e cookie de renovação protegidos com DPAPI em `%LOCALAPPDATA%/SingleDrive/*.bin`. Access token apenas em memória.
- Ignora links/junções. Exclusões locais preservam cópias remotas; a restauração pode incluir arquivos já excluídos localmente.
- Modificações geram novos uploads; catálogo aponta a última cópia de cada caminho, sem interface de versões.
- A primeira varredura desta versão reenvia arquivos de catálogos locais antigos sem IDs, para criar estrutura e catálogo remoto. Cópias antigas espalhadas na raiz permanecem preservadas, pois não há informação suficiente para movê-las com segurança.

## Restaurar após formatar

1. Execute esta versão e entre na mesma conta Google. Revogue o vínculo antigo no site se necessário e repita o vínculo.
2. Pause o backup e clique em Restaurar backup no agente.
3. Escolha o computador/pasta de origem pelo caminho original.
4. Confirme o destino sugerido ou escolha outra pasta. Documentos, Área de Trabalho, Imagens, Música, Vídeos e perfil são resolvidos pelo Windows atual, inclusive pastas redirecionadas. Caminhos externos mantêm a unidade quando disponível; sem ela, a sugestão usa Documentos.
5. Subpastas são recriadas. Downloads passam por tamanho/SHA-256 e renomeação local antes de ocupar o caminho final. Arquivos existentes são ignorados e contabilizados, sem sobrescrita. Caminhos absolutos, traversal, ADS, nomes reservados e destinos com links/junções são recusados.

O catálogo remoto funciona após perder as configurações locais ou revogar o PC de origem. Requer acesso aos arquivos e à conta Google que os armazena. Não recupera arquivos apagados permanentemente no provedor.

## Limitações e validação

Upload multipart ainda não retoma arquivos parcialmente enviados. O agente precisa estar executando; há bandeja e início automático opcional, sem serviço Windows ou instalador assinado. Não preserva ACLs NTFS, fluxos alternativos ou consistência de arquivos abertos. Pastas sem permissão são ignoradas. Falta de espaço/falha interrompe a restauração e preserva arquivos já concluídos.

Testes automatizados cobrem contratos HTTP com Prisma simulado, limite de vínculos, isolamento, catálogo, caminhos e preservação de arquivos existentes. O ciclo completo com Google e backup real ainda precisa ser validado em uma conta de teste.
