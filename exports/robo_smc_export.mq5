//+------------------------------------------------------------------+
//| robo_smc_export.mq5                                              |
//| Exporta todos os trades fechados de um robo (por Magic Number)   |
//| para CSV. Roda como Script: arraste no chart e clica OK.         |
//+------------------------------------------------------------------+
#property script_show_inputs
#property strict
#property version   "1.00"
#property description "Exporta historico de trades por Magic Number para CSV"

input long   InpMagic    = 20250321;              // Magic Number do robo (0 = todos)
input string InpSymbol   = "";                    // Simbolo (vazio = todos)
input string InpFileName = "robo_smc_export.csv"; // Arquivo de saida (MQL5/Files)
input bool   InpVerbose  = true;                  // Print resumo no Experts

//+------------------------------------------------------------------+
void OnStart()
{
    if(!HistorySelect(0, TimeCurrent()))
    {
        Print("HistorySelect falhou");
        return;
    }

    int handle = FileOpen(InpFileName, FILE_WRITE|FILE_TXT|FILE_ANSI);
    if(handle == INVALID_HANDLE)
    {
        Print("FileOpen falhou: ", GetLastError());
        return;
    }

    FileWriteString(handle,
        "ticket,time_open,time_close,symbol,type,volume,price_open,price_close,sl,tp,profit,commission,swap,comment,magic,score,threshold,ob_type,ob_pts\n");

    int total_deals = HistoryDealsTotal();
    long  pos_ids[];
    ArrayResize(pos_ids, 0);

    for(int i = 0; i < total_deals; i++)
    {
        ulong ticket = HistoryDealGetTicket(i);
        long pos_id = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
        if(pos_id == 0) continue;

        bool found = false;
        for(int k = 0; k < ArraySize(pos_ids); k++)
            if(pos_ids[k] == pos_id) { found = true; break; }
        if(!found)
        {
            int sz = ArraySize(pos_ids);
            ArrayResize(pos_ids, sz + 1);
            pos_ids[sz] = pos_id;
        }
    }

    int exported = 0;
    for(int p = 0; p < ArraySize(pos_ids); p++)
    {
        long pos_id = pos_ids[p];

        long     magic = 0;
        string   symbol = "";
        datetime t_open = 0, t_close = 0;
        double   price_open = 0, price_close = 0;
        double   sl = 0, tp = 0;
        double   volume = 0, profit = 0, commission = 0, swap = 0;
        int      type = -1;
        string   comment = "";

        for(int i = 0; i < total_deals; i++)
        {
            ulong ticket = HistoryDealGetTicket(i);
            if(HistoryDealGetInteger(ticket, DEAL_POSITION_ID) != pos_id) continue;

            long dmagic = HistoryDealGetInteger(ticket, DEAL_MAGIC);
            if(dmagic != 0) magic = dmagic;

            int entry = (int)HistoryDealGetInteger(ticket, DEAL_ENTRY);
            if(entry == DEAL_ENTRY_IN)
            {
                t_open      = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
                price_open  = HistoryDealGetDouble(ticket, DEAL_PRICE);
                volume      = HistoryDealGetDouble(ticket, DEAL_VOLUME);
                type        = (int)HistoryDealGetInteger(ticket, DEAL_TYPE);
                symbol      = HistoryDealGetString(ticket, DEAL_SYMBOL);
                sl          = HistoryDealGetDouble(ticket, DEAL_SL);
                tp          = HistoryDealGetDouble(ticket, DEAL_TP);
                comment     = HistoryDealGetString(ticket, DEAL_COMMENT);
            }
            else if(entry == DEAL_ENTRY_OUT)
            {
                t_close     = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
                price_close = HistoryDealGetDouble(ticket, DEAL_PRICE);
            }

            profit     += HistoryDealGetDouble(ticket, DEAL_PROFIT);
            commission += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
            swap       += HistoryDealGetDouble(ticket, DEAL_SWAP);
        }

        if(InpMagic != 0 && magic != InpMagic) continue;
        if(StringLen(InpSymbol) > 0 && symbol != InpSymbol) continue;
        if(t_open == 0 || t_close == 0) continue;

        StringReplace(comment, ",", " ");
        string row = StringFormat("%I64d,%s,%s,%s,%d,%.2f,%.5f,%.5f,%.5f,%.5f,%.2f,%.2f,%.2f,%s,%I64d,0.0000,0.0000,,0\n",
            pos_id,
            TimeToString(t_open,  TIME_DATE|TIME_SECONDS),
            TimeToString(t_close, TIME_DATE|TIME_SECONDS),
            symbol,
            type,
            volume,
            price_open,
            price_close,
            sl,
            tp,
            profit,
            commission,
            swap,
            comment,
            magic);

        FileWriteString(handle, row);
        exported++;
    }

    FileClose(handle);

    if(InpVerbose)
        PrintFormat("robo_smc_export: %d trades exportados para %s (magic=%I64d, symbol=%s)",
                    exported, InpFileName, InpMagic, InpSymbol);
    else
        Print("Export concluido.");
}
