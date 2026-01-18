# Documentação Técnica: Acompanhamento de Produção (Instituto)

**Arquivo Principal:** `acompanhamento_instituto.html`
**Lógica JS:** `src/js/acompanhamento-inst-logic.js`

Esta página é a interface principal onde os Institutos lançam sua produção semanal realizada. Diferente da tela de ofertas iniciais, aqui o foco é o preenchimento da execução (ofertado vs realizado) dividido por semanas.

## 1. Estrutura de Dados (Firestore)

A base de dados utilizada é a coleção `pactuacoes`.

### Documento `pactuacoes`
Cada documento representa o pacto de um **Instituto** para um **Procedimento** em um **Programa** específico e **Competência**.

```json
{
  "id": "progId_instId_sigtap_competencia",
  "instId": "string",
  "progId": "string",
  "sigtap": "string",
  "competencia": "YYYY-MM", // Ex: 2023-10
  "ofertaMinima": number,   // Meta pactuada
  "producao": {
    "realizada": number,    // Total realizado (Soma das semanas)
    "sem1": number,
    "sem2": number,
    "sem3": number,
    "sem4": number,
    "sem5": number
  }
}
```

## 2. Lógica de Exibição e Agrupamento

Devido à estrutura onde um mesmo procedimento (SIGTAP) pode pertencer a múltiplos programas (Incentivos), a interface agrupa visualmente esses registros para simplificar o lançamento.

### A. Agrupamento por SIGTAP
*   O sistema busca todas as pactuações do instituto para a competência selecionada.
*   Os registros são agrupaos pelo código **SIGTAP**.
*   **Exemplo:** Se o instituto tem "Consulta Médica" no programa "Oncologia" e também no programa "Cardiologia", aparecerá apenas **uma linha** na tabela para "Consulta Médica".

### B. Cálculo de Metas e Produção
Para a linha agrupada, os valores exibidos seguem a seguinte lógica:

1.  **Meta (Oferta Mínima):**
    *   O sistema utiliza a **Maior Meta (`maxMeta`)** encontrada entre os programas do grupo.
    *   *Regra de Negócio:* Assume-se que a meta exigida é o teto entre os incentivos.
    
2.  **Produção Realizada:**
    *   É a soma dos valores das semanas (`sem1` a `sem5`).
    *   `Total Realizado = sem1 + sem2 + sem3 + sem4 + sem5`

3.  **Barra de Progresso:**
    *   Calculado como `(Total Realizado / Max Meta) * 100`.
    *   **Cores:**
        *   Verde: >= 100%
        *   Amarelo: < 50%
        *   Azul: 50% - 99%

## 3. Lógica de Lançamento (Input Espelhado)

Quando o usuário digita um valor em uma das colunas de semana (ex: Sem 1):

1.  **Entrada Única:** O usuário vê apenas uma linha para o procedimento (SIGTAP).
2.  **Atualização em Lote (Espelhamento):**
    *   O sistema identifica todos os documentos de pactuação que compõem aquele grupo (todos os programas daquele SIGTAP).
    *   O valor digitado é replicado para o campo `semX` de **todos** esses documentos no banco de dados.
    *   O campo `producao.realizada` também é recalculado e salvo para todos os documentos.

> **Importante:** Isso garante consistência. Se o instituto produziu 10 consultas, isso conta como produção realizada para todos os incentivos que monitoram aquela consulta naquele mês.

## 4. Visão Global (Rede)

A página possui uma lógica oculta de "Estatísticas Globais" (`globalStats`):
*   Calcula o total de oferta de **toda a rede** (todos os institutos) para aquele SIGTAP.
*   Se a oferta do instituto somada à dos outros atingir a meta global da rede, um botão **"Meta Atingida"** é exibido, permitindo visualizar o detalhamento de quem contribuiu para a meta.

## 5. Filtros e Permissões

*   **Múltiplos Vínculos:** Usuários com perfil de gestão ou acesso a múltiplos institutos veem um seletor no menu de perfil para alternar a visão.
*   **Edição:** A edição é bloqueada se o usuário estiver no modo "Todos os Vinculados" ou se não tiver permissão de escrita.

---
**Resumo para Manutenção:**
Se precisar alterar como a meta é calculada (ex: somatória das metas em vez da maior), altere a lógica de `groups[key].maxMeta` na função `renderTable` do arquivo `acompanhamento-inst-logic.js`.
