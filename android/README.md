# SingleDrive Android

Aplicativo nativo em Kotlin e Jetpack Compose. Não usa WebView, HTML nem carrega o site como interface. A identidade visual segue o SingleDrive: verde, superfícies claras, cartões, lista/grade e navegação adaptada ao celular. Android 8.0 (API 26) ou superior.

## Dados e autenticação

O APK acessa `https://singledrive.onrender.com/` por HTTPS. A API continua usando o mesmo PostgreSQL no Neon e as mesmas contas e arquivos do site. Não é necessário migrar ou copiar dados. Nenhuma senha do banco, chave administrativa ou segredo OAuth é incluído no APK.

O token de acesso fica em memória. O cookie de renovação, o verificador PKCE e os dados necessários à retomada de envio ficam cifrados com AES-GCM; a chave é criada no Android Keystore. Backup e HTTP sem TLS estão desativados. Redirecionamentos de requisições autenticadas não são seguidos. A remoção dos dados do aplicativo remove a sessão local.

O login Google abre o navegador do sistema para consentimento; as telas e operações do aplicativo são nativas. O backend precisa conter o suporte a `client: android` implementado nesta entrega. O callback Google já existente no backend permanece cadastrado no Google; ele redireciona exclusivamente para `app.singledrive.android://oauth`, enviando código e estado, nunca tokens da sessão. O resgate exige PKCE e estado de uso único; conectar Drive também exige a sessão iniciadora. Não há parâmetro de redirecionamento arbitrário.

O esquema personalizado pode ser registrado por outro aplicativo Android. PKCE impede que esse aplicativo resgate o código sem o verificador; ainda é possível interferir na entrega do callback. Para distribuição pública, preferir Android App Links verificados em um domínio controlado, após definir a chave de assinatura de produção.

## Recursos desta versão

- Entrar com e-mail/senha existente ou Google; primeiro acesso pelo Google.
- Restaurar e renovar sessão, sair e conectar/desconectar contas Google.
- Escolher acesso essencial ou completo ao conectar uma conta.
- Listar, pesquisar, alternar lista/grade, navegar e criar pastas.
- Renomear, mover, enviar para lixeira e restaurar arquivos.
- Consultar espaço, atualizar cotas e sincronizar biblioteca.
- Enviar um arquivo por vez pelo seletor Android, em partes de 5 MiB; até 5 GB, sujeito aos limites do servidor e do Drive.
- Retomar envio interrompido mediante permissão persistente ao arquivo. O arquivo de origem deve permanecer disponível e inalterado. O servidor pode expirar a sessão de envio.
- Salvar arquivo pelo seletor de destino do Android, sem acesso irrestrito ao armazenamento.
- Abrir arquivo em aplicativo instalado, com URI temporária somente para leitura. Abertura limitada a 200 MB por arquivo, cache privado de até aproximadamente 400 MB; arquivos antigos são removidos após 24 horas na próxima abertura. Para arquivos maiores, usar Salvar no dispositivo. A cópia salva no destino escolhido permanece sob controle do usuário.

## Limites conhecidos

Esta é uma primeira versão para testes, não uma declaração de equivalência completa com o site. Não inclui criação de links públicos/convites, administração de provedores S3, seleção múltipla, cadastro por senha ou navegação de todo o Drive externo. Mostra a biblioteca indexada pelo SingleDrive. O compartilhamento público permanece fora do app devido a um defeito previamente identificado no backend.

Envios são direcionados ao Google Drive pelo backend. Transferências exigem manter o app aberto; não há serviço de transferência em segundo plano. Ao interromper o app ou perder conexão, use Retomar. Descartar retomada só apaga o registro local; a sessão remota expira conforme o servidor/provedor. Um arquivo sem tamanho informado pelo seletor Android não pode ser enviado nesta versão.

A velocidade e disponibilidade continuam dependendo da API, do Render, do Neon e do Google. Um APK nativo não elimina o cold start da infraestrutura. Alterar de essencial para completo exige nova autorização Google.

## Compilar

Requisitos: JDK 17 ou 21, Android SDK Platform 36, Build Tools e licenças aceitas. Defina `ANDROID_HOME` ou configure `sdk.dir` no arquivo local `local.properties` (não versionado).

```powershell
cd android
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

APK padrão: `app/build/outputs/apk/debug/app-debug.apk`. Para usar outro disco para os arquivos de build, defina `SINGLEDRIVE_BUILD_ROOT`; caches também podem ser redirecionados com `GRADLE_USER_HOME`.

O APK debug é assinado automaticamente para instalação de teste. Não usar essa assinatura para publicação na Play Store. A versão de produção exige keystore própria, guardada fora do Git, versionamento e política de privacidade revisados. Para distribuição pela Play Store gerar AAB assinado; para distribuição direta gerar APK de release assinado.

## Validação

Os testes de rede usam um servidor HTTPS local com certificado de teste confiado apenas na instância dos testes. Verificam renovação e repetição após 401, limpeza de sessão inválida, bloqueio de redirecionamentos, recusa de URLs externas e rejeição de cookies inseguros ou de domínio. Eles não substituem o teste real de autorização Google.

Antes da distribuição pública, instalar em celular e verificar login Google, conectar contas nos dois modos, enviar e retomar um arquivo, abrir/salvar, mover, renomear, lixeira/restauração e sair/entrar. Usar arquivos descartáveis. Verificar acessibilidade, tela pequena, modo escuro e rotação. A API precisa estar com a atualização Android publicada para testar o fluxo completo.
