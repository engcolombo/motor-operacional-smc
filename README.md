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

A versão principal está em `diario-pro-plus.html`, acessível pelo botão **Diário Pro+** na página inicial e pelos checklists. O tema grafite reduz cores decorativas, gradientes, sombras e emojis; os controles de conta ficam em **Conta e sincronização**. Inclui todas as abas do Pro, inclusive Robô SMC e Backtests, com navegação adaptada ao celular.

O Diário Pro foi desativado; `diario.html` redireciona para o Pro+, preservando os links antigos. O Pro+ usa `diario-core.js`, `diario-backtests.js`, o mesmo login, as mesmas chaves locais e as mesmas tabelas Supabase da versão anterior. Os dados existentes continuam disponíveis sem migração. O tema adicional está em `diario-pro-plus.css`. Ao publicar, envie esses arquivos junto com os HTMLs.

## Checklist de Trade

O checklist único é o **Checklist de Trade**, em `checklist.html`, com o visual sóbrio anteriormente chamado Checklist Pro. A versão visual antiga foi removida. Links para `checklist-pro.html` redirecionam para o checklist atual; modelos, critérios e marcações locais foram preservados.

## Imagens anexadas aos trades

Para habilitar um print do gráfico por trade, execute `supabase-attachments.sql` no SQL Editor do mesmo projeto Supabase. O script cria ou atualiza o bucket privado `trade-attachments`, limita os arquivos a JPEG, PNG ou WebP de até 20 MB e aplica políticas que aceitam apenas arquivos no diretório do usuário autenticado. Se já executou a versão de 5 MB, execute novamente para atualizar o limite.

No Diário Pro+, abra ou crie um trade e use **Imagem do gráfico**. O arquivo é enviado apenas quando o trade é salvo com login ativo; a prévia usa URL temporária e não deixa o bucket público. Trocar, remover ou excluir um trade remove o arquivo correspondente do Storage depois que a alteração do trade for confirmada.

### Ativação no Supabase

1. Abra o projeto `cqjmxywdhlxlsltkrrxm` no painel do Supabase (o mesmo projeto já usado pelo diário).
2. Entre em **SQL Editor**, abra uma consulta nova e cole todo o conteúdo de `supabase-attachments.sql`.
3. Clique em **Run**. Pode executar novamente se já tinha configurado o limite anterior de 5 MB.
4. Em **Storage**, confira o bucket `trade-attachments`: ele deve estar privado, com limite de `20971520` bytes (20 MB) e os tipos JPEG, PNG e WebP. Se o limite global do projeto for menor que 20 MB, aumente-o nas configurações de Storage.
5. Abra a versão atualizada do Diário Pro+, entre com sua conta e crie ou edite uma operação. Escolha a imagem em **Imagem do gráfico** e clique em **Salvar**.
6. Reabra a operação pelo botão **Editar** em Trades recentes ou na aba Trades. A prévia deve aparecer; clique nela para abrir a imagem completa. Teste uma troca e uma remoção para conferir as políticas.

O SQL cria o bucket e as políticas de Storage automaticamente. Os metadados do anexo ficam no `payload` já existente de `trades_pro`; não é necessário criar outra coluna nem colocar chave administrativa no site. O backup JSON inclui os caminhos dos anexos, mas não contém os arquivos de imagem. Alterações locais precisam ser publicadas para aparecer no site do GitHub Pages.

## Trades Profit — revisão da execução

A aba lateral **Trades Profit** importa o CSV do relatório de operações do Profit. Abra o Diário Pro+, escolha **Importar CSV do Profit**, confira a prévia e clique em **Importar e analisar**. Não é necessário alterar as colunas nem apagar as linhas de cabeçalho da conta.

O módulo inclui:

- Revisão diária com curva do resultado realizado, pico, devolução, resultado da manhã/tarde, entradas e sequências de perdas.
- Sinais de operações próximas, pausa curta após perda, possível vingança, excesso de entradas, aumento do volume negociado, continuidade após limites e devolução do lucro.
- Confirmação do contexto de cada sinal e do motivo de saída de cada operação. Resultados negativos não são classificados automaticamente como stops.
- Check-in de estado antes/depois, energia, urgência de recuperar perdas, respeito aos setups, acertos, gatilhos e ação substituta.
- Regras ajustáveis e compromissos para uma data futura, avaliados quando esse pregão for importado. O próximo dia útil é apenas uma sugestão: feriados devem ser ajustados.
- Evolução da aderência, recorrência dos sinais e histórico de compromissos. A nota de ritmo e limites usa regras temporais observáveis com pesos iguais; não depende do lucro e não mede saúde mental ou competência profissional. A execução SMC é avaliada separadamente, incluindo pendências.

### Dados e cálculos

O resultado é **Res. Operação menos o valor absoluto de Comissões**, em centavos inteiros. A coluna **Total** é acumulada e não é somada. **TET** não é usado como pausa; esta é calculada entre o último fechamento conhecido e a nova abertura. A análise respeita operações simultâneas e não usa perdas futuras para explicar entradas anteriores.

Os valores ficam no dia do fechamento; a contagem de entradas fica no dia da abertura. Horários são preservados como exportados, sem conversão de fuso. Quantidades de compra/venda são volume agregado, não exposição máxima. Custos ausentes ou zerados no CSV não são estimados.

Conta, ativo, abertura, fechamento e lado identificam uma operação. Reimportações idênticas são ignoradas e valores alterados aparecem como atualizações na prévia. Alterar os horários de uma operação gera uma identidade diferente. Linhas inválidas e operações abertas são informadas antes da confirmação. O importador aceita UTF-8, Windows-1252 e UTF-16, com datas brasileiras e valores com vírgula decimal.

As regras iniciais são referências editáveis. A primeira revisão salva uma fotografia das regras daquele dia. Compromissos futuros usam as regras atuais no momento de salvar. As comparações consideram apenas os arquivos importados e podem mudar quando o plano muda.

### Armazenamento e backup

**Trades Profit salva apenas neste navegador; não sincroniza com o Supabase.** Os dados são separados pelo login do diário (ou perfil sem login) e pela conta do Profit. Entrar ou sair da conta muda o perfil exibido; não transfere dados automaticamente.

Use os botões **Backup** e **Restaurar** da própria aba. Eles incluem operações, regras, revisões, motivos de saída e compromissos. O botão geral de exportação do diário não inclui esse módulo. Restaurar exige confirmação e substitui apenas os dados Profit do perfil atual. Faça backup antes de limpar o navegador ou mudar de dispositivo/endereço do site.

Nenhum CSV pessoal foi incorporado ao código do site. O titular do relatório não é armazenado. Este módulo não envia o arquivo para serviços externos e não executa nem bloqueia ordens no Profit.

### Arquivos e validação

Publique junto com a página os arquivos `diario-profit-analysis.js`, `diario-profit-desk.js`, `diario-profit.js` e `diario-profit.css`. A navegação e os pontos de integração estão em `diario-pro-plus.html` e `diario-core.js`.

Teste unitário, com casos sintéticos:

```text
node test-diario-profit.cjs
node test-diario-profit-desk.cjs
```

Para conferir também uma exportação de referência de 76 operações em cinco pregões:

```text
node test-diario-profit.cjs "CAMINHO_DO_CSV"
node test-diario-profit-desk.cjs "CAMINHO_DO_CSV"
```

O teste opcional `test-diario-profit-ui.cjs` recebe porta de depuração do Chrome, URL da prévia local, caminho do CSV de referência e diretório de artefatos. Execute-o somente em um perfil isolado de testes: ele limpa o armazenamento Profit desse perfil e testa importação, duplicatas, revisões, planos, isolamento por login, falha de armazenamento, backup/restauração e telas de 390/320 px.


### Revisão comportamental orientada ao SMC

A leitura agora segue o método declarado: novo setup antes de cada entrada, sem trades consecutivos, e alvo de referência de **2R**. O intervalo confirmado é de **10 minutos** entre o último fechamento e a próxima entrada; saídas positivas abaixo de 2R exigem uma exceção previamente prevista e registrada. Essa confirmação é aplicada uma única vez aos perfis anteriores e às regras históricas. Depois da atualização, novas personalizações do intervalo são preservadas. A pausa após perda nunca é menor que o intervalo geral entre entradas.

Em **Operações e evidências → Revisão SMC**, registre:

- Novo setup, nome, evidência da estrutura/invalidação/gatilho e o estado emocional relatado.
- Risco **inicial total** em reais (1R), alvo financeiro original, contratos planejados e contratos efetivos na entrada.
- Execução simples ou com parciais/adições, justificativa de eventual exceção abaixo do alvo.
- Base estrutural do stop, manutenção ou tipo de alteração, regra que autorizava a alteração e motivo de saída.

O risco não é inferido do prejuízo de outro trade nem do resultado da própria operação. **R bruto = Res. Operação / risco inicial**; R líquido também é exibido, mas comissões que reduzem um ganho bruto de 2R não o classificam como saída antecipada. O alvo planejado abaixo da referência e o ganho realizado abaixo dela são sinais distintos.

A quantidade agregada do CSV só representa quantidade inicial quando o usuário confirma execução simples. Em parciais/adições, informe os contratos efetivos da entrada. Divergências nessa confirmação são recusadas para execução simples. O sistema não deduz que um stop foi alterado a partir de um ganho pequeno ou de uma perda maior que 1R: a gestão do stop exige revisão explícita. Perda acima de 1R gera investigação de execução, slippage, contratos e stop.

Saída positiva abaixo do alvo pode ser tratada como exceção somente quando a regra permite e a justificativa prevista está registrada. É possível configurar que toda saída abaixo da referência seja sinalizada. Campos ausentes permanecem **pendentes**, sem virar aprovação automática. Critérios sem operações aplicáveis são identificados separadamente.

A nota principal mede **ritmo e limites**, incluindo o intervalo mínimo SMC. Qualidade do setup, R, contratos e stop têm acompanhamento separado, com cobertura das revisões. A nova leitura de ritmo é aplicada ao histórico usando os intervalos e limites salvos por dia.

O painel **Treino comportamental** combina evidências e relatos com perguntas e ações específicas. **Levar ao próximo pregão** preenche o compromisso, que deve ser revisado e salvo. Os compromissos de setup, alvo, contratos e stop ficam pendentes enquanto faltarem dados das operações. A evolução mostra desvios, cobertura de risco, R bruto médio dos trades conhecidos e relatos emocionais; emoções relatadas não são apresentadas como diagnóstico inferido pelo CSV.

Backups anteriores continuam compatíveis. Os novos campos e compromissos SMC são incluídos no backup/restauração da aba.

### Mesa — reunião de fechamento

A visão inicial **Mesa** apresenta um parecer de processo, episódios concretos da sessão e seis frentes de cobrança: seleção e espera, resposta às perdas, sustentação do alvo, contratos e stop, devolução de lucro e resposta aos gatilhos relatados. Cada frente separa evidência observada, hipótese a investigar, explicações alternativas, ação exigida e prova de cumprimento. O texto é calculado localmente por regras e relatos; não usa um serviço de IA externo nem constitui avaliação clínica.

A conclusão distingue quebra de controle, execução fora do plano, falta de evidência e execução consistente. Lucro não apaga desvio e prejuízo não comprova indisciplina. Limites ainda não personalizados são identificados como referências. O resultado das operações sinalizadas é uma soma descritiva, sem atribuir causalidade ao comportamento ou estimar lucro que poderia ter sido obtido.

Os episódios mostram apenas resultados conhecidos antes da entrada. A recorrência considera até dez pregões importados até a data escolhida; a comparação de ritmo precisa de pelo menos três pregões em cada janela. Compromissos anteriores mostram critérios cumpridos, descumpridos e pendentes, sem aprovar critérios SMC cuja evidência esteja ausente.

No debrief, registre um episódio, pensamento, estado percebido, decisão, alternativa, ação substituta e evidência de cumprimento. Os rascunhos são salvos automaticamente. Para concluir, preencha os campos obrigatórios, confirme a revisão dos fatos e salve um compromisso futuro originado nessa sessão. **Preparar compromisso cobrado** preenche a proposta; revise e salve. A conclusão do debrief registra a revisão, sem apagar os desvios nem as pendências. Alterações nos dados que sustentam o parecer exigem reconferência. O debrief também integra o backup.

O teste de navegador cobre a conclusão do debrief, sua preservação ao recarregar, a reconferência após mudança de evidência, backup e visualização em celular.
