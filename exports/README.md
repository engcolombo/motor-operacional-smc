# Export do Robo SMC para o Diario Pro

Fluxo: o **script MQL5** roda no MT5 e gera um CSV com todos os trades fechados de um robo (filtrados por Magic Number). O **Diario Pro** importa esse CSV num clique, dedupa por ticket e exibe estatisticas da estrategia.

## 1. Instalar o script no MT5

1. No MT5: `Arquivo` -> `Abrir Pasta de Dados`.
2. Vai em `MQL5/Scripts/`.
3. Copia `robo_smc_export.mq5` pra essa pasta.
4. No MT5, painel `Navegador` -> `Scripts` -> clica direito -> `Atualizar`.

## 2. Rodar o script

1. Abre qualquer chart no MT5 (qualquer ativo).
2. Painel `Navegador` -> `Scripts` -> arrasta `robo_smc_export` no chart.
3. Janela de inputs aparece:
   - `InpMagic`: Magic Number do robo. **Default = 20250321 (V900 OB/VWAP)**.
   - `InpSymbol`: deixa vazio pra exportar todos, ou ex: `WINQ25`.
   - `InpFileName`: nome do CSV. Default `robo_smc_export.csv`.
4. Clica `OK`. Aba `Experts` mostra `robo_smc_export: N trades exportados`.

CSV vai parar em `MQL5/Files/robo_smc_export.csv` (mesma pasta de dados).

## 3. Importar no site

1. Abre site -> nav `🤖 Robô SMC`.
2. Confirma Magic Number e Símbolo (mesmos do script).
3. Clica `📥 Importar trades` -> seleciona o CSV em `MQL5/Files/`.
4. Site dedupa por ticket (`robo-${pos_id}`) e atualiza/insere. Roda diario sem medo de duplicar.
5. Estatisticas e tabela atualizam.

## 4. Trocar de robo / Magic / Corretora

| O que mudou         | Onde alterar |
|---------------------|--------------|
| Magic Number novo   | Input `InpMagic` do script **e** campo `Magic Number` na view Robô SMC |
| Versao do robo (V900 -> V2000) | Input `InpMagic` no script, salva no site. Cada versao tem magic propria |
| Corretora nova      | Reinstala script na nova instalacao MT5 (cada corretora tem `MQL5/Files` proprio). Magic pode permanecer |
| Outro ativo         | `InpSymbol` no script ou deixa vazio + filtro no site |

## 5. Como o site processa o CSV

- Le linha a linha do CSV (`,` como separador).
- Para cada row, monta `trade.id = "robo-<pos_id>"`.
- Upsert no Supabase (`trades_pro`) com `source: "robo_smc"`.
- Trades com mesmo `id` ja salvos sao **atualizados**, nao duplicados.
- Caso o robo modifique SL/TP apos abertura, reimportar pega o estado final.

## 6. Trades em aberto

Script ignora posicoes abertas (`time_close == 0`). So exporta trades fechados. Se quer ver ao vivo: roda script depois que posicao fechar.

## 7. Limitacoes

- CSV nao traz comissoes da corretora alem das ja debitadas pelo broker. `pnl = profit + commission + swap`.
- `R` nao e calculado automaticamente (precisaria contract spec por simbolo). Use a coluna PnL.
- Se voce muda o Magic durante a vida do trade (raro), filtro pode pular esse trade.
