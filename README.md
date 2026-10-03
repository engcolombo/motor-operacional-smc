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
