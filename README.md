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

### Chave Gemini vinculada ao login

Execute também `supabase-mentor.sql` no SQL Editor do mesmo projeto. Depois, no Diário Pro+, entre na sua conta e abra **Psicologia → Mentor → Minha chave Gemini**. Cole a chave e clique em **Salvar na minha conta**. O botão **Recarregar da conta** permite tentar novamente após configurar o banco ou recuperar a conexão.

A tabela separada `mentor_credentials` permite ler, salvar e remover apenas a linha cujo `user_id` corresponde ao usuário autenticado, por RLS. Visitantes sem login não têm acesso. A chave não entra no Git, nos backups, PDFs, trades, taxas nem ciclos. **Remover da conta** apaga a configuração persistida; **Limpar desta aba** limpa apenas a memória. Outro navegador carrega a chave no login; uma aba já aberta precisa recarregar para receber alterações feitas em outro dispositivo.

Esta implementação guarda a chave no banco com controle de acesso, não em um cofre criptografado por usuário. O navegador autenticado recebe a chave e chama o Gemini diretamente; administradores do banco também podem acessá-la. Não é um proxy de servidor. Os relatórios psicológicos e CSV continuam locais; sincronizar a chave não sincroniza esses registros. Nunca inclua chaves reais nos arquivos SQL ou de código.

Referência de autorização: https://supabase.com/docs/guides/database/postgres/row-level-security

### Tentativas automáticas do Mentor

Ao clicar em analisar, o Mentor consulta `models.list` com a chave da conta e prioriza os modelos de texto nesta ordem: `gemini-3.8-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemma-4-31b-it`. É uma prioridade do aplicativo, não um ranking universal. Só os modelos retornados com suporte a `generateContent` são usados. Se a consulta do catálogo falhar temporariamente, tenta os identificadores conhecidos uma vez cada.

Cada modelo tem até 90 segundos. Indisponibilidade, cota esgotada, resposta incompleta ou inválida levam ao próximo; cancelamento, chave inválida e bloqueio de conteúdo encerram a sequência. Não há tentativas infinitas nem chamadas antes de clicar. Cada tentativa pode consumir cota. O Gemma recebe instruções de JSON no prompt; todos os modelos passam pela mesma validação de formato e referências. O resultado só é salvo após passar pela validação e conservar o contexto original. O nome do modelo que respondeu fica salvo, aparece no fim do relatório e acompanha backup/PDF.

Na tela inicial, importação, backups, plano e critérios ficam recolhidos. O relatório completo mantém sua profundidade. Testes: `node test-diario-mentor-fallback.cjs`; teste de navegador com respostas simuladas: `node test-diario-mentor-ui.cjs PORTA URL DIRETORIO_DE_ARTEFATOS`.

Catálogo e contratos: https://ai.google.dev/gemini-api/docs/models · https://ai.google.dev/api/models · https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api

Depois disso, faca login no site. O botao `Salvar trade` grava na tabela `trades`, e o botao `Excluir` remove o registro do Supabase.

A opcao `Lembrar` mantem a sessao do Supabase salva no navegador depois do primeiro login. A senha nao fica gravada no codigo do site.

## Diário Pro+

### Ciclos e histórico arquivado

Em **Meu histórico**, use **Arquivar e iniciar novo ciclo** e dê um nome ao plano encerrado. Após a confirmação, todos os trades manuais do ciclo atual (inclusive os ativos ocultos pelo filtro) e a Psicologia ficam agrupados no arquivo. Visão geral, Operações, Calendário, Estatísticas, Diário e Psicologia passam a mostrar o ciclo atual vazio. Novas operações e revisões entram nesse ciclo. Robô SMC, Backtests e a aba Taxas permanecem como estavam; o acumulado de taxas continua incluindo o histórico completo.

Selecione um arquivo para revisar seus trades nas cinco telas ou escolha **Histórico completo** para comparar toda a evolução. **Devolver ao ciclo atual** desfaz o arquivamento desse grupo e recalcula os resultados com as taxas atuais. Ao arquivar, as taxas são congeladas por trade para preservar os resultados históricos; notas, parciais, datas e anexos são mantidos. Editar um trade arquivado preserva seu vínculo com o arquivo.

**Psicologia acompanha o mesmo seletor:** suas importações, revisões, preparações, compromissos, regras e vínculos são arquivados juntos e podem ser consultados no ciclo antigo. No Histórico completo, selecione um ciclo para abrir suas análises; o PDF reúne todos os ciclos separadamente. A restauração devolve também a Psicologia, mas interrompe sem alterar nenhum histórico se houver revisões diferentes para a mesma data ou vínculos conflitantes. Até um ciclo apenas com registros psicológicos pode ser arquivado.

A Psicologia continua **local por navegador e login**, sem sincronização no Supabase. Seu botão **Backup** inclui o ciclo atual e os ciclos psicológicos arquivados. O estado completo é reservado antes de arquivar os trades; uma interrupção entre etapas deixa uma cópia de recuperação em `diarioProfit_v1_<usuario>_cycle_pending`, conferida ao reabrir/atualizar o diário. Falta de espaço ou registros inválidos impedem iniciar o arquivamento. Use o Backup da Psicologia e o PDF para guardar uma cópia fora deste navegador.

Com login, o arquivamento e a restauração são gravados em um único lote na tabela existente `trades_pro`, dentro do `payload`. Não é necessário executar SQL. Sem login, registros locais ficam apenas neste navegador. Um backup local anterior à última alteração é guardado em `diarioProBeforeArchive_v1_<usuario>`. Se esse backup não couber, a operação é interrompida antes de alterar os registros. Falhas na gravação da nuvem mantêm o ciclo local intacto; falhas de cache depois do sucesso na nuvem são informadas. A leitura da nuvem busca todas as páginas do histórico.

**PDF com imagens** prepara o ciclo selecionado inteiro, independentemente dos filtros de ativo, mês ou busca. O relatório inclui resumo, detalhes de cada operação, notas, erros, tags, parciais, imagens incorporadas e a parte psicológica disponível (preparação, estados antes/depois, revisões, debrief, compromissos, anotações e leitura das execuções importadas). Na aba aberta, clique em **Salvar em PDF / Imprimir** e escolha **Salvar como PDF**. Imagens privadas exigem login; se alguma não puder ser carregada ou decodificada, o relatório não libera a impressão. O PDF salvo contém as imagens, sem depender de links temporários. A exportação não arquiva os registros automaticamente.

O botão **Exportar** continua gerando JSON de todos os trades, incluindo arquivos anteriores e metadados dos anexos; os arquivos de imagem não estão dentro desse JSON. **Importar JSON** substitui todo o histórico local e pede confirmação explícita. **Excluir ciclo atual (local)** preserva os arquivos anteriores.

Arquivos a publicar juntos: `diario-pro-plus.html`, `diario-pro-plus.css`, `diario-core.js`, `diario-archives.js` e `diario-profit.js`. Testes: `node test-diario-archives.cjs`, `node test-diario-psychology-cycles.cjs` e, com Chrome isolado, `node test-diario-archives-ui.cjs PORTA URL_LOCAL PASTA_DE_EVIDENCIAS`.

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

## Psicologia · revisão diária e evolução

### Mentor de execução com Gemini

A Psicologia abre na aba **Mentor de execução**. Ela mantém os cálculos existentes e adiciona interpretação assistida por IA, com foco em preparação, risco documentado, respeito às regras, disciplina e revisão deliberada. A IA propõe uma prioridade, hipóteses com perguntas de confirmação e até cinco sessões de treino com métricas de processo. Não certifica que o usuário é profissional, não garante lucro e não executa ordens.

Para usar, selecione o pregão e a fonte/conta, abra **Conectar minha chave Gemini**, cole sua chave pessoal do Google AI Studio e clique em **Usar chave nesta aba**. Depois, confira os dados a enviar e clique em **Analisar meu processo com Gemini**. Conectar a chave não faz uma chamada; cada análise consome a cota do projeto Google. O padrão é `gemini-3.8-flash`, configurável conforme os modelos disponíveis na sua conta. A primeira chamada real confirma se chave/modelo/cota estão acessíveis.

A chave é temporária e fica apenas na memória da aba; é removida ao recarregar, navegar para fora, remover a chave ou trocar o login. Não é gravada em localStorage/sessionStorage, backup, Supabase, repositório ou URL. A chamada vai diretamente para `generativelanguage.googleapis.com`, com a chave no cabeçalho `x-goog-api-key`. Este é um modo pessoal de **traga sua própria chave**: scripts executados na página e ferramentas locais do navegador têm acesso ao ambiente da sessão. Para disponibilizar uma chave compartilhada de produção, implemente um backend autenticado com segredo no servidor; nunca coloque uma chave compartilhada no JavaScript. Consulte a [orientação de chaves do Google](https://ai.google.dev/gemini-api/docs/api-key).

O contexto enviado contém até dez pregões até a data selecionada, do ciclo e conta escolhidos. Inclui totais e checagens calculados localmente, relatos, preparações, compromissos e até trinta registros detalhados de cada fonte do dia. Para Profit/TradingView, registros do diário só são incluídos quando vinculados às execuções dessa conta. A janela e os cortes são informados na interface e no contexto. Imagens, email, identificador do login e número da conta não são incluídos automaticamente. Dados pessoais digitados nos relatos continuam sendo texto livre: a prévia permite conferi-los antes do envio. Valores e moedas das fontes não são somados.

A API usa saída estruturada, conforme a [documentação do Gemini](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). A aplicação valida o formato, os limites dos campos e as referências às evidências. Citações existentes não comprovam que a interpretação é correta; o usuário deve conferi-la. Não há busca na web, ferramentas externas, ordens, tentativas automáticas ou reenvio em segundo plano. Respostas incompletas, cota excedida e referências inexistentes preservam a análise anterior. Cancelamentos e mudanças de conta, ciclo, dia ou registros impedem salvar respostas atrasadas em outro contexto.

As análises são salvas por conta e pregão na Psicologia local, com cópia do contexto usado. Alterações no contexto marcam a análise como desatualizada e impedem preparar compromissos com ela. **Preparar compromisso a partir da prioridade** preenche um rascunho; o usuário revisa e salva. O relatório salvo acompanha o ciclo arquivado, a restauração, o Backup da Psicologia e o PDF. As regras financeiras não são alteradas pela IA. Uma análise por pregão é mantida; uma nova análise bem-sucedida substitui a anterior desse pregão.

Publique também `diario-mentor.js`, `diario-profit.js`, `diario-profit.css` e a página atualizada. Validação: `node test-diario-mentor.cjs`; navegador isolado: `node test-diario-mentor-ui.cjs PORTA URL_LOCAL PASTA_DE_EVIDENCIAS`. Os testes usam respostas simuladas e uma chave fictícia, sem enviar dados reais ao Google.

A aba lateral **Psicologia · revisão diária e evolução**, imediatamente abaixo de **Checklist de Trade**, importa relatórios do Profit e do TradingView e usa os registros já existentes no diário. Abra o Diário Pro+, escolha **Importar CSV do Profit**, confira a prévia e clique em **Importar e analisar**. Não é necessário alterar as colunas nem apagar as linhas de cabeçalho da conta.

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

**As importações, revisões e vínculos da Psicologia são salvos apenas neste navegador; não sincronizam com o Supabase.** O diário original mantém sua sincronização existente; o módulo lê esses registros depois de confirmar que pertencem ao login atual. Os dados são separados pelo login do diário (ou perfil sem login) e pela conta do Profit. Entrar ou sair da conta muda o perfil exibido; não transfere dados automaticamente.

Use os botões **Backup** e **Restaurar** da própria aba. Eles incluem operações, regras, revisões, motivos de saída e compromissos. O botão geral de exportação do diário não inclui esse módulo. Restaurar exige confirmação e substitui apenas os dados da Psicologia do perfil atual. Faça backup antes de limpar o navegador ou mudar de dispositivo/endereço do site.

Nenhum CSV pessoal foi incorporado ao código do site. O titular do relatório não é armazenado. Este módulo não envia o arquivo para serviços externos e não executa nem bloqueia ordens no Profit.

### Arquivos e validação

Publique junto com a página os arquivos `diario-profit-analysis.js`, `diario-profit-desk.js`, `diario-profit-supervision.js`, `diario-profit-journal.js`, `diario-profit.js` e `diario-profit.css`. A navegação e os pontos de integração estão em `diario-pro-plus.html` e `diario-core.js`.

Teste unitário, com casos sintéticos:

```text
node test-diario-profit.cjs
node test-diario-profit-desk.cjs
node test-diario-profit-supervision.cjs
node test-diario-profit-journal.cjs
node test-diario-tradingview.cjs
```

Para conferir também uma exportação de referência de 76 operações em cinco pregões:

```text
node test-diario-profit.cjs "CAMINHO_DO_CSV"
node test-diario-profit-desk.cjs "CAMINHO_DO_CSV"
node test-diario-profit-supervision.cjs "CAMINHO_DO_CSV"
```

O teste opcional `test-diario-profit-ui.cjs` recebe porta de depuração do Chrome, URL da prévia local, caminho do CSV de referência e diretório de artefatos. Execute-o somente em um perfil isolado de testes: ele limpa o armazenamento da Psicologia e do diário desse perfil e testa importação, duplicatas, revisões, planos, isolamento por login, falha de armazenamento, backup/restauração e telas de 390/320 px.


### Revisão comportamental orientada ao SMC

A leitura agora segue o método declarado: novo setup antes de cada entrada, sem trades consecutivos, e alvo de referência de **2R**. O intervalo confirmado é de **10 minutos** entre o último fechamento e a próxima entrada; saídas positivas abaixo de 2R exigem uma exceção previamente prevista e registrada. Essa confirmação é aplicada uma única vez aos perfis anteriores e às regras históricas. Depois da atualização, novas personalizações do intervalo são preservadas. A pausa após perda nunca é menor que o intervalo geral entre entradas.

Em **Operações e evidências → Revisão SMC**, registre:

- Novo setup, nome, evidência da estrutura/invalidação/gatilho e o estado emocional relatado.
- Risco **inicial total** na moeda da origem selecionada — BRL no Profit, USD no TradingView — (1R), alvo financeiro original, contratos planejados e contratos efetivos na entrada.
- Execução simples ou com parciais/adições, justificativa de eventual exceção abaixo do alvo.
- Base estrutural do stop, manutenção ou tipo de alteração, regra que autorizava a alteração e motivo de saída.

O risco não é inferido do prejuízo de outro trade nem do resultado da própria operação. **R bruto = Res. Operação / risco inicial**; R líquido também é exibido, mas comissões que reduzem um ganho bruto de 2R não o classificam como saída antecipada. O alvo planejado abaixo da referência e o ganho realizado abaixo dela são sinais distintos.

A quantidade agregada do CSV só representa quantidade inicial quando o usuário confirma execução simples. Em parciais/adições, informe os contratos efetivos da entrada. Divergências nessa confirmação são recusadas para execução simples. O sistema não deduz que um stop foi alterado a partir de um ganho pequeno ou de uma perda maior que 1R: a gestão do stop exige revisão explícita. Perda acima de 1R gera investigação de execução, slippage, contratos e stop.

Saída positiva abaixo do alvo pode ser tratada como exceção somente quando a regra permite e a justificativa prevista está registrada. É possível configurar que toda saída abaixo da referência seja sinalizada. Campos ausentes permanecem **pendentes**, sem virar aprovação automática. Critérios sem operações aplicáveis são identificados separadamente.

A nota principal mede **ritmo e limites**, incluindo o intervalo mínimo SMC. Qualidade do setup, R, contratos e stop têm acompanhamento separado, com cobertura das revisões. A nova leitura de ritmo é aplicada ao histórico usando os intervalos e limites salvos por dia.

O painel **Treino comportamental** combina evidências e relatos com perguntas e ações específicas. **Levar ao próximo pregão** preenche o compromisso, que deve ser revisado e salvo. Os compromissos de setup, alvo, contratos e stop ficam pendentes enquanto faltarem dados das operações. A evolução mostra desvios, cobertura de risco, R bruto médio dos trades conhecidos e relatos emocionais; emoções relatadas não são apresentadas como diagnóstico inferido pelo CSV.

Backups anteriores continuam compatíveis. Os novos campos e compromissos SMC são incluídos no backup/restauração da aba.

### Mesa — reunião de fechamento

A visão inicial **Mesa** apresenta um parecer de processo, episódios concretos da sessão e uma auditoria documental seguida de seis frentes de cobrança: seleção e espera, resposta às perdas, sustentação do alvo, contratos e stop, devolução de lucro e resposta aos gatilhos relatados. Cada frente separa evidência observada, hipótese a investigar, explicações alternativas, ação exigida e prova de cumprimento. O texto é calculado localmente por regras e relatos; não usa um serviço de IA externo nem constitui avaliação clínica.

A conclusão distingue quebra de controle, execução fora do plano, falta de evidência e execução consistente. Lucro não apaga desvio e prejuízo não comprova indisciplina. Limites ainda não personalizados são identificados como referências. O resultado das operações sinalizadas é uma soma descritiva, sem atribuir causalidade ao comportamento ou estimar lucro que poderia ter sido obtido.

Os episódios mostram apenas resultados conhecidos antes da entrada. A recorrência considera até dez pregões importados até a data escolhida; a comparação de ritmo precisa de pelo menos três pregões em cada janela. Compromissos anteriores mostram critérios cumpridos, descumpridos e pendentes, sem aprovar critérios SMC cuja evidência esteja ausente.

No debrief, registre um episódio, pensamento, estado percebido, decisão, alternativa, ação substituta e evidência de cumprimento. Os rascunhos são salvos automaticamente. Para concluir, preencha os campos obrigatórios, confirme a revisão dos fatos e salve um compromisso futuro originado nessa sessão. **Preparar compromisso cobrado** preenche a proposta; revise e salve. A conclusão do debrief registra a revisão, sem apagar os desvios nem as pendências. Alterações nos dados que sustentam o parecer exigem reconferência. O debrief também integra o backup.

O teste de navegador cobre a conclusão do debrief, sua preservação ao recarregar, a reconferência após mudança de evidência, backup e visualização em celular.

### Preparação, prioridade e insights

Em **Preparação**, escolha uma data, inclusive futura, e registre condições dos setups, exceções, risco máximo por operação, sono, tensão, urgência, gatilho e resposta planejada. Com registros do diário, a revisão também funciona antes da primeira importação, no grupo Diário · sem CSV. Importar uma origem cria seu grupo próprio de preparação e acompanhamento. O horário local de salvamento é comparado com a primeira entrada: registros posteriores não comprovam um plano prévio. Uma preparação salva fica preservada na interface quando já existem entradas importadas para sua data; registre ajustes no debrief e no próximo pregão. O horário vem do navegador e não é uma auditoria externa.

A Mesa mostra o plano preparado junto da execução. Um risco inicial informado acima do teto registrado antes da primeira entrada gera cobrança de controle; comparação com preparação retrospectiva é identificada como retrospectiva. Riscos ausentes não são reconstruídos pelo resultado. A preparação também conserva uma fotografia das regras, respeitando a precedência de planos e revisões existentes.

O compromisso futuro tem **uma prioridade principal, um gatilho, uma ação e uma evidência esperada**. As outras regras selecionadas dão suporte. No pregão seguinte, o critério prioritário é avaliado separadamente do relato pessoal. Registre quando percebeu o gatilho, se executou a ação, o episódio que sustenta a resposta e a dificuldade encontrada. Um relato positivo não apaga um desvio observado; prioridades pessoais, critérios não aplicáveis, ausência de importação e falta de evidência são separados. Compromissos antigos permanecem compatíveis, sem inventar uma prioridade retroativa.

Em **Insights**, compare entradas abaixo/acima do intervalo, após perda/após ganho ou zero e manhã/tarde, com filtro por ativo. A janela considera até 20 pregões importados até a data selecionada, somente operações encerradas até essa data. O agrupamento de manhã/tarde usa a entrada; o resultado integral da operação pode encerrar em outro período. Cada grupo mostra operações, resultado líquido, média, proporção positiva, R bruto conhecido e cobertura/desvios de setup, contratos e stop. Primeiras entradas sem fechamento anterior conhecido ficam fora das comparações de pausa e perda.

Amostras menores que dez operações em qualquer grupo recebem um aviso exploratório; isso não é teste estatístico nem comprovação de causalidade. Diferenças de ativo, quantidade, plano e contexto afetam a comparação. O painel não estima lucro recuperável nem transforma associação em diagnóstico psicológico.

A reunião semanal compara a semana da data selecionada, até esse dia, com a semana anterior, começando na segunda-feira. Mostra frequência de entradas consecutivas, documentação SMC, preparação prévia, prioridades cumpridas/descumpridas/pendentes e ações/evidências relatadas. O filtro de ativo vale para as comparações; a reunião semanal considera todos os ativos da conta. Sem pelo menos três pregões em cada semana, não há conclusão de tendência. Dias não importados não são considerados dias disciplinados. A documentação suficiente não implica execução correta.

Preparações, prioridades e acompanhamento entram no backup/restauração da própria aba e continuam separados por login e conta. Não há alteração de tabelas, SQL ou sincronização Supabase nesta atualização.


### Diário × execução: documentação e contexto

A conferência usa o dia da **entrada** e a família do ativo. No Profit, todas as contas importadas do perfil são consideradas para evitar que um mesmo registro cubra execuções de contas diferentes. O diário pode ter mais registros, mas nunca menos por data/ativo. Também comparamos as categorias de resultado — alvo/positivo, stop/negativo e zero — sem exigir igualdade monetária. Um ativo diferente não cobre uma falta.

Menos registros ou distribuição incompatível recebe cobrança grave na Mesa e impede concluir o debrief, preservando o rascunho. Resultado positivo/negativo é apenas um indicador quando o motivo de saída não foi confirmado. Registros abertos, parciais com resultado misto, dados inválidos e vínculos desatualizados exigem revisão, sem inventar intenção ou aprovar resultados desconhecidos.

Em **Diário × execução**, confirme os pares sugeridos por horário (até dois minutos), lado e ativo. Não há vínculo automático; um registro só pode se vincular a uma execução. Os vínculos trazem setup, justificativa, quantidade e motivo de saída para campos ausentes da revisão SMC; risco/alvo só são aproveitados quando a moeda é compatível. Não somamos novamente o resultado do diário. Campos já revisados prevalecem. Alterações posteriores no diário atualizam a leitura e exigem reconferir um debrief concluído.

A presença de setup e texto significa documentação, não comprova qualidade técnica nem que o racional foi escrito antes da ordem. O painel também mostra erros relatados, cobertura de risco e alvos abaixo do plano. Sem CSV, mostra contexto do diário sem certificar completude da execução. Os vínculos entram no backup da Psicologia; os registros originais do diário continuam no seu próprio armazenamento/backup.

### Importar do TradingView

Use **Importar CSV do TradingView**, selecione o CSV **Histórico de negociação** do **Paper Trading em USD**, confira a prévia e confirme a importação. O formato aceito tem Símbolo, Número da negociação, Tipo, Data e hora, Tamanho (qtd), L&P líquido USD e Comissão USD. Arquivos de posições e outras moedas são recusados com orientação.

- Entrada e saída são agrupadas por símbolo e número da negociação; o líquido e a comissão são lidos uma única vez na saída. A comissão não é descontada novamente do líquido. O bruto usado em R é recomposto como líquido + comissão informada na saída.
- Tamanho (valor), percentuais e acumulados não são somados e não são tratados como risco inicial. Quantidades fracionárias são preservadas.
- Datas como “15 de out. de 2026, 03:11” são mantidas no horário exportado. Saída “Abertura” indica posição aberta e fica fora das métricas; a prévia informa a quantidade ignorada.
- Pares ambíguos, datas inválidas ou quantidades incompatíveis são listados para revisão, sem fabricar uma execução simples.
- A origem **TradingView · Paper Trading · USD** tem regras, revisões e resultados separados do Profit em BRL. Não há conversão cambial nem soma entre as origens. O arquivo não identifica a conta simulada: este grupo representa um único histórico de Paper Trading por perfil; não misture exportações de contas simuladas distintas.
- Na conciliação da simulação, confirme manualmente quais registros do diário pertencem a ela. Apenas os vinculados cobrem a contagem simulada; vínculos de outra origem não são reutilizados. Valores em reais do diário não preenchem risco/alvo em USD: informe os valores originais em dólares na revisão SMC.

Não é necessário executar SQL ou ajustar o Supabase para esta atualização. Use o backup da Psicologia para preservar os dados locais.

O teste de navegador aceita um quinto argumento opcional com o CSV TradingView de referência (2 operações encerradas, 1 aberta). Ele valida as duas importações, moedas, quantidades fracionárias, vínculos, persistência e layout em celular.
