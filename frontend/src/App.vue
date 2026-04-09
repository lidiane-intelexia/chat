<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

type ReportRow = {
  id: string;
  link: string;
  downloadLink: string;
  client: string;
  period: string;
  totalMessages: number;
  participants: number;
  generatedAt: string;
  format: 'pdf' | 'gdoc';
};

const apiBase = import.meta.env.VITE_API_URL || '';

const form = reactive({
  name: '',
  cnpj: '',
  email: '',
  phone: '',
  link: '',
  startDate: '',
  endDate: '',
  format: 'pdf' as 'pdf' | 'gdoc',
  similarityThreshold: 0.82
});

const loading = ref(false);
const error = ref('');
const reports = ref<ReportRow[]>([]);

const canSubmit = computed(() => Boolean(form.name || form.cnpj || form.email || form.phone || form.link));

function formatPeriod(start?: string, end?: string) {
  if (!start && !end) return 'Período não informado';
  return `${start || '...'} → ${end || '...'}`;
}

async function submit() {
  error.value = '';
  if (!canSubmit.value) {
    error.value = 'Informe ao menos um identificador do cliente.';
    return;
  }

  loading.value = true;
  try {
    const payload = {
      query: {
        name: form.name || undefined,
        cnpj: form.cnpj || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        link: form.link || undefined
      },
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      format: form.format,
      similarityThreshold: form.similarityThreshold
    };

    const response = await fetch(`${apiBase}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    if (!text) {
      throw new Error('Servidor retornou resposta vazia. A geração pode ter excedido o tempo limite.');
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Resposta inválida do servidor. A geração pode ter excedido o tempo limite.');
    }

    if (!response.ok) {
      throw new Error(data?.error || 'Falha ao gerar o relatório.');
    }

    reports.value.unshift({
      id: data.fileId,
      link: data.webViewLink,
      downloadLink: data.downloadLink,
      client: data.summary.client,
      period: formatPeriod(data.summary.periodStart, data.summary.periodEnd),
      totalMessages: data.summary.totalMessages,
      participants: data.summary.participants,
      generatedAt: new Date().toLocaleString('pt-BR'),
      format: form.format
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Erro inesperado ao gerar o relatório.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen">
    <header class="px-8 pt-10 pb-6 max-w-[1400px] mx-auto">
      <div class="flex flex-col gap-3">
        <span class="text-sm uppercase tracking-[0.4em] text-emerald-200/70">Chat Intelligence</span>
        <h1 class="text-4xl md:text-5xl font-display font-semibold text-white">
          Dashboard de Relatórios do Google Chat
        </h1>
        <p class="text-slate-300 max-w-2xl">
          Encontre conversas, gere relatórios estruturados e acompanhe o histórico de entregas em tempo real.
        </p>
      </div>
    </header>

    <main class="px-8 pb-16 max-w-[1400px] mx-auto flex flex-col gap-6">
      <!-- Nova Busca — largura total -->
      <section class="bg-ink-800/90 border border-white/10 rounded-3xl p-10 shadow-glow">
        <div class="flex items-center justify-between mb-8">
          <div>
            <h2 class="text-2xl font-display">Nova Busca</h2>
            <p class="text-slate-400 text-sm">Preencha ao menos um identificador para iniciar a varredura.</p>
          </div>
          <span class="text-xs px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-200">Tempo real</span>
        </div>

        <form class="grid gap-6" @submit.prevent="submit">
          <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div class="flex flex-col gap-2">
              <label class="text-xs uppercase tracking-wide text-slate-400">Nome</label>
              <input v-model="form.name" class="input" placeholder="Empresa Alfa" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-xs uppercase tracking-wide text-slate-400">CNPJ</label>
              <input v-model="form.cnpj" class="input" placeholder="00.000.000/0000-00" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-xs uppercase tracking-wide text-slate-400">E-mail</label>
              <input v-model="form.email" class="input" placeholder="contato@empresa.com" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-xs uppercase tracking-wide text-slate-400">Telefone</label>
              <input v-model="form.phone" class="input" placeholder="(11) 90000-0000" />
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs uppercase tracking-wide text-slate-400">Link da Rede Social / Site</label>
            <input v-model="form.link" class="input" placeholder="https://instagram.com/empresa ou https://empresa.com.br" />
          </div>

          <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div class="flex flex-col gap-2">
              <label class="text-xs uppercase tracking-wide text-slate-400">Data inicial</label>
              <input v-model="form.startDate" type="date" class="input" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-xs uppercase tracking-wide text-slate-400">Data final</label>
              <input v-model="form.endDate" type="date" class="input" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-xs uppercase tracking-wide text-slate-400">Formato</label>
              <select v-model="form.format" class="input">
                <option value="pdf">PDF</option>
                <option value="gdoc">Google Doc</option>
              </select>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-xs uppercase tracking-wide text-slate-400">
                Precisão da busca
              </label>
              <div class="flex items-center gap-3 h-[50px]">
                <input
                  v-model.number="form.similarityThreshold"
                  type="range"
                  min="0.6"
                  max="0.95"
                  step="0.01"
                  class="w-full"
                />
                <span class="text-sm text-slate-200 w-12 text-right font-medium">{{ form.similarityThreshold.toFixed(2) }}</span>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between gap-4 pt-2">
            <p v-if="error" class="text-sm text-ember-500">{{ error }}</p>
            <div class="flex items-center gap-3 ml-auto">
              <span v-if="!canSubmit" class="text-xs text-slate-400">Informe um identificador.</span>
              <button
                type="submit"
                class="px-6 py-3 rounded-full bg-emerald-500 text-slate-900 font-semibold hover:bg-emerald-400 transition disabled:opacity-50"
                :disabled="loading"
              >
                Gerar relatório
              </button>
            </div>
          </div>
        </form>
      </section>

      <!-- Status + Relatórios — lado a lado -->
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
        <section class="bg-ink-800/90 border border-white/10 rounded-3xl p-6">
          <h2 class="text-2xl font-display">Status da Varredura</h2>
          <p class="text-slate-400 text-sm">Acompanhe o progresso enquanto varremos o Google Chat.</p>

          <div class="mt-6 flex items-center gap-4" v-if="loading">
            <div class="h-12 w-12 rounded-full border-2 border-emerald-400/40 border-t-emerald-400 animate-spin"></div>
            <div>
              <p class="text-emerald-200 font-medium">Buscando conversas e gerando relatório...</p>
              <p class="text-xs text-slate-400">Isso pode levar alguns minutos dependendo do volume.</p>
            </div>
          </div>

          <div class="mt-6" v-else>
            <p class="text-slate-300">Sem execução ativa no momento.</p>
          </div>
        </section>

        <section class="bg-ink-800/90 border border-white/10 rounded-3xl p-6">
          <div class="flex items-center justify-between">
            <h2 class="text-2xl font-display">Últimos Relatórios</h2>
            <span class="text-xs uppercase tracking-[0.3em] text-slate-400">Drive</span>
          </div>

          <div class="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table class="min-w-full text-sm">
              <thead class="bg-white/5 text-slate-300">
                <tr>
                  <th class="text-left px-4 py-3 font-medium">Cliente</th>
                  <th class="text-left px-4 py-3 font-medium">Período</th>
                  <th class="text-left px-4 py-3 font-medium">Mensagens</th>
                  <th class="text-left px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="reports.length === 0" class="text-slate-400">
                  <td colspan="4" class="px-4 py-6">Nenhum relatório gerado ainda.</td>
                </tr>
                <tr
                  v-for="report in reports"
                  :key="report.id"
                  class="border-t border-white/5 hover:bg-white/5 transition"
                >
                  <td class="px-4 py-3">
                    <p class="text-white font-medium">{{ report.client }}</p>
                    <p class="text-xs text-slate-400">{{ report.generatedAt }} · {{ report.format.toUpperCase() }}</p>
                  </td>
                  <td class="px-4 py-3 text-slate-300">{{ report.period }}</td>
                  <td class="px-4 py-3 text-slate-300">
                    {{ report.totalMessages }} mensagens · {{ report.participants }} participantes
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                      <a
                        :href="report.link"
                        target="_blank"
                        rel="noreferrer"
                        class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 text-xs font-medium transition"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5-6H18m0 0v4.5m0-4.5l-7.5 7.5"/></svg>
                        Visualizar
                      </a>
                      <a
                        :href="report.downloadLink"
                        class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white text-xs font-medium transition"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
                        Download
                      </a>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.input {
  @apply bg-ink-900/60 border border-white/10 rounded-2xl px-5 py-3.5 text-slate-100 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 transition w-full;
}
</style>
