# motor-operacional-smc

Diario pessoal de trade com avaliacao operacional SMC e salvamento no Supabase.

## Site

https://engcolombo.github.io/motor-operacional-smc/

## Supabase

Projeto conectado:

```txt
https://cqjmxywdhlxlsltkrrxm.supabase.co
```

Antes de usar o site, abra o SQL Editor do Supabase e execute `supabase-schema.sql`.

Depois disso, faca login no site. O botao `Salvar trade` grava na tabela `trades`, e o botao `Excluir` remove o registro do Supabase.

A opcao `Lembrar` mantem a sessao do Supabase salva no navegador depois do primeiro login. A senha nao fica gravada no codigo do site.

## Diário Pro+

A terceira versão está em `diario-pro-plus.html`, acessível pelo botão **Diário Pro+** na página inicial ou no menu do Pro. O tema grafite reduz cores decorativas, gradientes, sombras e emojis; os controles de conta ficam em **Conta e sincronização**. Inclui todas as abas do Pro, inclusive Robô SMC e Backtests, com navegação adaptada ao celular.

Pro e Pro+ usam `diario-core.js`, `diario-backtests.js`, o mesmo login, as mesmas chaves locais e as mesmas tabelas Supabase. Alternar a versão não exige importar ou migrar dados. O tema adicional está em `diario-pro-plus.css`. Ao publicar, envie esses arquivos junto com os HTMLs.

## Imagens anexadas aos trades

Para habilitar um print do gráfico por trade, execute `supabase-attachments.sql` no SQL Editor do mesmo projeto Supabase. O script cria ou atualiza o bucket privado `trade-attachments`, limita os arquivos a JPEG, PNG ou WebP de até 20 MB e aplica políticas que aceitam apenas arquivos no diretório do usuário autenticado. Se já executou a versão de 5 MB, execute novamente para atualizar o limite.

No Diário Pro ou Pro+, abra ou crie um trade e use **Imagem do gráfico**. O arquivo é enviado apenas quando o trade é salvo com login ativo; a prévia usa URL temporária e não deixa o bucket público. Trocar, remover ou excluir um trade remove o arquivo correspondente do Storage depois que a alteração do trade for confirmada.

### Ativação no Supabase

1. Abra o projeto `cqjmxywdhlxlsltkrrxm` no painel do Supabase (o mesmo projeto já usado pelo diário).
2. Entre em **SQL Editor**, abra uma consulta nova e cole todo o conteúdo de `supabase-attachments.sql`.
3. Clique em **Run**. Pode executar novamente se já tinha configurado o limite anterior de 5 MB.
4. Em **Storage**, confira o bucket `trade-attachments`: ele deve estar privado, com limite de `20971520` bytes (20 MB) e os tipos JPEG, PNG e WebP. Se o limite global do projeto for menor que 20 MB, aumente-o nas configurações de Storage.
5. Abra a versão atualizada do Diário Pro ou Pro+, entre com sua conta e crie ou edite uma operação. Escolha a imagem em **Imagem do gráfico** e clique em **Salvar**.
6. Reabra a operação pelo botão **Editar** em Trades recentes ou na aba Trades. A prévia deve aparecer; clique nela para abrir a imagem completa. Teste uma troca e uma remoção para conferir as políticas.

O SQL cria o bucket e as políticas de Storage automaticamente. Os metadados do anexo ficam no `payload` já existente de `trades_pro`; não é necessário criar outra coluna nem colocar chave administrativa no site. O backup JSON inclui os caminhos dos anexos, mas não contém os arquivos de imagem. Alterações locais precisam ser publicadas para aparecer no site do GitHub Pages.
