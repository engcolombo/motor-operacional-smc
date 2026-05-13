//+------------------------------------------------------------------+
//| robo_smc_export.mq5                                              |
//| Backfill historico de trades por Magic Number para CSV.          |
//| Append-only: nao apaga linhas existentes, so adiciona os que     |
//| ainda nao estao no arquivo (dedup por ticket = position_id).     |
//+------------------------------------------------------------------+
#property script_show_inputs
#property strict
#property version   "1.10"
#property description "Backfill historico de trades por Magic (append + dedup por ticket)"

input long   InpMagic    = 20250321;              // Magic Number do robo (0 = todos)
input string InpSymbol   = "";                    // Simbolo (vazio = todos)
input string InpFileName = "robo_smc_export.csv"; // Arquivo de saida (MQL5/Files)
input bool   InpVerbose  = true;                  // Print resumo no Experts

string g_existing_tickets[];

bool ContainsTicket(const string ticket)
{
   for(int i = 0; i < ArraySize(g_existing_tickets); i++)
      if(g_existing_tickets[i] == ticket) return true;
   return false;
}

void AddTicket(const string ticket)
{
   int sz = ArraySize(g_existing_tickets);
   ArrayResize(g_existing_tickets, sz + 1);
   g_existing_tickets[sz] = ticket;
}

bool LoadExistingTickets(const string filename)
{
   int handle = FileOpen(filename, FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE) return false;

   bool first_line = true;
   while(!FileIsEnding(handle))
   {
      string line = FileReadString(handle);
      if(first_line) { first_line = false; continue; }
      if(StringLen(line) == 0) continue;
      int comma = StringFind(line, ",");
      string tk = (comma > 0 ? StringSubstr(line, 0, comma) : line);
      StringTrimLeft(tk); StringTrimRight(tk);
      if(StringLen(tk) > 0) AddTicket(tk);
   }
   FileClose(handle);
   return true;
}

void OnStart()
{
   if(!HistorySelect(0, TimeCurrent()))
   {
      Print("HistorySelect falhou");
      return;
   }

   LoadExistingTickets(InpFileName);

   int handle = FileOpen(InpFileName, FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
   {
      PrintFormat("FileOpen falhou (%s): %d", InpFileName, GetLastError());
      return;
   }

   bool file_empty = (FileSize(handle) == 0);
   FileSeek(handle, 0, SEEK_END);

   if(file_empty)
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

   int appended = 0;
   int skipped = 0;
   for(int p = 0; p < ArraySize(pos_ids); p++)
   {
      long pos_id = pos_ids[p];
      string ticket_str = IntegerToString(pos_id);
      if(ContainsTicket(ticket_str)) { skipped++; continue; }

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
         ulong tk = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(tk, DEAL_POSITION_ID) != pos_id) continue;

         long dmagic = HistoryDealGetInteger(tk, DEAL_MAGIC);
         if(dmagic != 0) magic = dmagic;

         int entry = (int)HistoryDealGetInteger(tk, DEAL_ENTRY);
         if(entry == DEAL_ENTRY_IN)
         {
            t_open     = (datetime)HistoryDealGetInteger(tk, DEAL_TIME);
            price_open = HistoryDealGetDouble(tk, DEAL_PRICE);
            volume     = HistoryDealGetDouble(tk, DEAL_VOLUME);
            type       = (int)HistoryDealGetInteger(tk, DEAL_TYPE);
            symbol     = HistoryDealGetString(tk, DEAL_SYMBOL);
            sl         = HistoryDealGetDouble(tk, DEAL_SL);
            tp         = HistoryDealGetDouble(tk, DEAL_TP);
            comment    = HistoryDealGetString(tk, DEAL_COMMENT);
         }
         else if(entry == DEAL_ENTRY_OUT)
         {
            t_close     = (datetime)HistoryDealGetInteger(tk, DEAL_TIME);
            price_close = HistoryDealGetDouble(tk, DEAL_PRICE);
         }

         profit     += HistoryDealGetDouble(tk, DEAL_PROFIT);
         commission += HistoryDealGetDouble(tk, DEAL_COMMISSION);
         swap       += HistoryDealGetDouble(tk, DEAL_SWAP);
      }

      if(InpMagic != 0 && magic != InpMagic) continue;
      if(StringLen(InpSymbol) > 0 && symbol != InpSymbol) continue;
      if(t_open == 0 || t_close == 0) continue;

      StringReplace(comment, ",", " ");
      string row = StringFormat("%I64d,%s,%s,%s,%d,%.2f,%.5f,%.5f,%.5f,%.5f,%.2f,%.2f,%.2f,%s,%I64d,0.0000,0.0000,,0\n",
         pos_id,
         TimeToString(t_open,  TIME_DATE|TIME_SECONDS),
         TimeToString(t_close, TIME_DATE|TIME_SECONDS),
         symbol, type, volume, price_open, price_close, sl, tp,
         profit, commission, swap, comment, magic);

      FileWriteString(handle, row);
      AddTicket(ticket_str);
      appended++;
   }

   FileClose(handle);

   if(InpVerbose)
      PrintFormat("robo_smc_export: %d novos appendados, %d ja existiam, total agora %d em %s (magic=%I64d, symbol=%s)",
                  appended, skipped, ArraySize(g_existing_tickets), InpFileName, InpMagic, InpSymbol);
   else
      PrintFormat("Append concluido: %d novos.", appended);
}
