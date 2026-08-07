# Registro da Revisão — Sistema de Orçamento / Incentivo SUS

> Documento de trabalho para **retomar a revisão depois**. Atualizado em **julho/2026**.
> **Status:** ajustes funcionais **concluídos** (build verde). Falta apenas o **Lote C — Segurança**.
> Contexto: Firebase/Firestore + Vite multipágina, JS vanilla (ES modules). **Sistema ainda não está em produção.**

---

## 1. Objetivo da revisão
Eliminar inconsistências entre telas (meta/incentivo calculados de formas diferentes em cada tela), melhorar a estrutura e corrigir bugs. Responder e documentar em pt-BR.

---

## 2. Modelo canônico ⭐ (a parte mais importante)

Toda a lógica de **meta / atingimento / incentivo** foi centralizada em **[src/js/business-rules.js](src/js/business-rules.js)** (fonte única da verdade). Todas as telas passaram a importar dali, em vez de reimplementar fórmulas.

### Mapeamento de campos (conceito ↔ banco)

| Conceito | Campo no Firestore | Quem lança | Papel |
|---|---|---|---|
| **Oferta** | `ofertado` | Instituto | base do **atingimento** da meta |
| **Produzido** | `producao.realizada` | Central (no fechamento do mês) | = **Previsto** (base do pagamento previsto) |
| **Retorno SMSA** | `producao.aprovada` | Central (retorno da secretaria) | quantidade aprovada = **Pago** (pagamento em última instância) |
| **Meta** | `ofertaMinima` (ou `grupo.ofertaMinima`) | — | alvo pactuado |

### Regras de negócio
- **Atingimento** = Oferta ÷ Meta.
- **Meta da rede** = soma **entre** institutos, **deduplicando** o mesmo procedimento repetido em vários incentivos do **mesmo** instituto (conta uma vez por instituto — usa o maior valor).
- **Incentivo** é **calculado, não digitado**: só existe quando **meta atingida E oferta > 0**; então `vlrIncentivo × quantidade`. Oferta 0 → sem incentivo.
- **Pagamento**: *previsto* sobre o **produzido** (`producao.realizada`); *última instância* sobre o **aprovado SMSA** (`producao.aprovada`).
- **Status** (limiares em `STATUS_THRESHOLDS`): `< 70%` crítico · `70–99%` atenção · `≥ 100%` ok.

### Funções expostas
`getOferta`, `getProduzido`, `getRetornoSMSA`, `getMeta(p, gruposOferta)`, `atingimentoPct`, `metaAtingida`, `statusMeta`, `calcIncentivo({tipo, vlrIncentivo, quantidade, oferta, meta})`, `consolidarSigtap`.
`calcIncentivo` é **extensível por `tipo`** (hoje só `'padrao'`; há um `case 'percentual'` reservado para regras futuras, sem mexer em telas).

---

## 3. Competência padrão (padronizada em TODAS as telas)
`DateUtils.competenciaPadrao(comps)` em [src/js/utils/date-utils.js](src/js/utils/date-utils.js): abre no **mês atual se tiver dados**; senão na **competência mais recente com dados anterior** ao mês atual; senão na mais recente.
⚠️ **Cuidado (já corrigido):** calcular a competência padrão **antes** de injetar o mês atual na lista — senão ela "vê" o mês atual vazio e o escolhe.

---

## 4. O que foi alterado (por tela / área)
- **Lançamento** — [src/js/lancamento-logic.js](src/js/lancamento-logic.js) — migrado p/ business-rules + competência padrão.
- **Acompanhamento instituto** — [src/js/acompanhamento-inst-logic.js](src/js/acompanhamento-inst-logic.js).
- **Acompanhamento central** — [src/js/acompanhamento-logic.js](src/js/acompanhamento-logic.js) — colunas **Previsto** (produzido) e **Pago** (retorno SMSA).
- **Dashboards** central + instituto — [src/js/dashboard-logic.js](src/js/dashboard-logic.js) — Previsto/Pago onde cabe; gráfico semanal do instituto com legendas **"Oferta"** (não "Produção").
- **Financeiro do instituto** — [src/js/financeiro-inst-logic.js](src/js/financeiro-inst-logic.js) / [financeiro_instituto.html](financeiro_instituto.html) — **removida "Meta Atingida"**; colunas passaram a: Qtd Ofertada, Realizado, Faturado SIGTAP, Inc. Previsto, Inc. Pago. Meta agora usa a **do próprio instituto** (`meta > 0 && ofertado >= meta`), não a da rede (era o que divergia do lançamento, que é o "certo").
- **Instituto** — [src/js/instituto-logic.js](src/js/instituto-logic.js).

---

## 5. Nova tela — Lançamento de Produção (central)
- Novos: **[lancamento_producao.html](lancamento_producao.html)** + **[src/js/producao-logic.js](src/js/producao-logic.js)**.
- Tabela achatada como a de acompanhamento, mas com **inputs inline por linha** (Produzido / Retorno SMSA) — **sem abrir modais**. Linhas **zebradas**. Agrupa por instituto + SIGTAP.
- Registrada em [vite.config.js](vite.config.js) e adicionada ao `isAdminPage` do [src/js/auth-guard.js](src/js/auth-guard.js).

---

## 6. Headers + "Meu Perfil" (última etapa funcional)
- **Header limpo** (logo + menu + botão **Sair**) padronizado em **todas** as telas da central: dashboard, acompanhamento, lançar produção, alertas, configuração, usuários.
- **Ícone/chip de perfil removido** do header (e o `<script>` inline que o alimentava). O `auth-guard.js` foi mantido — ele expõe `window.handleLogout` (usado pelo botão Sair).
- **"Meu Perfil" virou uma aba** dentro de **Gestão de Usuários** ([usuarios.html](usuarios.html)), reaproveitando [src/js/perfil-logic.js](src/js/perfil-logic.js). A página `perfil.html` continua existindo, mas nada mais aponta para ela.

---

## 7. Dados / infra
- **[src/js/repository.js](src/js/repository.js)**: helper `parseMoney` (aceita número ou string pt-BR); `savePactuacao` monta o **ID composto** (`progId_instId_sigtap_competencia`) quando não há id; `importData` usa `parseMoney` + `{ merge: true }`.
- **Migração de dados executada**: ofertas movidas para `ofertado`; **0 duplicatas** encontradas.
- **Build**: `npm run build`.
  ⚠️ Se aparecer `vite:html-inline-proxy ... No matching HTML proxy module found`, é **cache** do vite: `rm -rf node_modules/.vite dist` e rebuildar.

---

## 8. PENDENTE — Lote C: Segurança (deixado por último, de propósito)

Fatos já confirmados no código:
- `cleanUrls: true` no [firebase.json](firebase.json) → o item 1 é **bug real, mas só no site publicado** (no teste local com `.html` não afeta).
- O `123456` é apenas um `prompt()` **client-side** em [configuracao.html](configuracao.html) (`checkAdminPassword`) → teatro de segurança (dá pra burlar pelo console).

| # | Item | Risco | Nota |
|---|---|---|---|
| 2 | senha `123456` hardcoded | 🟢 Baixo | isolado em 1 tela; não toca cálculo/instituto |
| 4a | `alertas.html` fora do `isAdminPage` | 🟢 Baixo | adicionar 1 item na lista do guard |
| 3 | XSS — `innerHTML` com dados do Firestore sem escape | 🟡 Baixo urgência | ferramenta interna + dados de gente confiável; risco = regressão visual espalhada |
| 1 | auth-guard usa `.includes('.html')` vs `cleanUrls` | 🟠 Médio | porta de entrada de **todas** as telas; testar no **deploy** |
| 4b | status "Inativo" nunca checado no login | 🟠 Médio | pode **barrar usuário legítimo** se `status` estiver inconsistente (ausente/caixa) |
| 4c | `Institutos_Leitor` consegue editar o lançamento | 🟠 Médio | mexe no fluxo de **salvar** |
| 5 | **regras do Firestore abertas** | 🔴 Alto | não é só código — precisa **publicar + testar ao vivo** no Firebase; se ficar restritivo demais, trava acesso/gravação |

**Ordem recomendada:** `2 → 3 → 4a` (baixos) → `1, 4b, 4c` (acesso/papel, validando login e papéis) → **`5` por último** (deploy + teste ao vivo, feito em conjunto).

---

## 9. Como retomar
1. `npm run build` para confirmar que a base está verde (limpar cache do vite se der o erro de proxy).
2. Aguardar o retorno do **teste funcional** (login repassado à testadora).
3. Corrigir o que o teste apontar (base limpa, sem segurança misturada).
4. Iniciar o **Lote C** na ordem acima.

---

## 10. Espelhamento procedimento ⇄ incentivo (feature em andamento)

**Objetivo:** dar uma **segunda porta de entrada** para os vínculos de incentivo, agora pela aba de **Procedimentos** — hoje só dá para cadastrar pela aba de Incentivos ([openItensModal](configuracao.html) / [saveItemIncentivo](configuracao.html)). Não é dado novo: é a MESMA coleção `pactuacoes` (tupla `progId × instId × sigtap × competencia`, com `ofertaMinima`, `vlrIncentivo`, `grupoOfertaId`), vista pelo outro lado (com o `sigtap` travado no procedimento aberto).

### Decisões travadas (com o usuário)
- **Local de oferta = instituto** (`instId`).
- **Meta é do usuário:** ao adicionar item novo, perguntar a meta; **sugerir a do mês anterior** do mesmo trio (incentivo+instituto+procedimento), se houver.
- **Grupo** entra no form (filtrado ao incentivo escolhido).
- **Remover vínculo bloqueia se já houver produção/oferta lançada** (`ofertado`/`producao.realizada`).
- **UI = tabela completa**: ao abrir o procedimento, mostra TODOS os vínculos dele (linha por incentivo+instituto+mês) + form de adicionar. Espelho exato do modal de itens do incentivo.

### Guardas contra desencontro (obrigatórias)
1. **Uma única função de escrita (upsert)** compartilhada pelas duas abas — nunca duas validações.
2. Antes de gravar, **checar se a tupla já existe** (em `localPactuacoes`) → editar em vez de duplicar/sobrescrever cego. Cuidado: o ID é composto e `savePactuacao` faz `{merge:true}` — mandar `ofertaMinima:0` sem querer **zera meta** existente.
3. **Competência sempre no formato `jan/26`** (é o que o banco guarda; o filtro `type=month` é convertido em [renderPO](configuracao.html)).
4. Ao anexar a grupo, **garantir o `sigtap` dentro de `grupo.procedimentos[]`** — senão a soma da rede fica torta.
5. `vlrSigtapBase` = `vlrSigtap` do próprio procedimento.

### ⚠️ Descoberta importante (mudou o plano)
O `configuracao.html` ganhou (em paralelo) um sistema de **variante/especialidade**: o `sigtap` do procedimento virou **identidade composta** (`0301010072-CARD`), com `codigoFaturamento` (SIGTAP real, só dígitos), `variante` e `especialidade`. O antigo `cleanSigtap` (apagava não-dígitos) foi trocado por **`normalizarCodigo`** ([business-rules.js](src/js/business-rules.js)), que **preserva as letras** — então variantes do mesmo SIGTAP real **não colidem** mais na agregação da rede.
- Consequência: o plano antigo de "**código sintético só-dígitos `99…`** para procedimento sem SIGTAP" foi **DESCARTADO** — seria um segundo esquema de identidade competindo com a variante. O usuário confirmou que "sem SIGTAP" **já está coberto pela variante**. Sem trabalho de sem-SIGTAP.
- O novo modal deve **exibir o código composto + especialidade** (usar `codigoExibicao`) e chavear pelo `sigtap` composto (a identidade do procedimento).

### Ordem de execução
1. Extrair **upsert compartilhado** (refactor de `saveItemIncentivo`, sem mudar comportamento) → build.
2. **Modal novo na aba de Procedimentos** (tabela de vínculos + form add/editar/remover) reusando o upsert → build.
3. **Guardas** (competência, grupo, bloqueio de remoção com produção, vlrSigtapBase) → build final.

Nenhuma tela consumidora muda (mesma estrutura de dado). `savePactuacao` no [repository.js](src/js/repository.js) já monta o ID composto e faz merge.

---

## 11. Consultas especializadas — variante/especialidade (CONCLUÍDO, build verde)

**Problema:** várias consultas especializadas (cardio, orto…) **compartilham o mesmo código SIGTAP real**. Antes, a gambiarra inventava códigos falsos (`000001`, `000002`) no campo `sigtap` — distinguia no relatório, mas **perdia o SIGTAP verdadeiro**.

**Solução (abordagem de baixo risco escolhida com o usuário):** manter o campo `sigtap` como **identidade** (os ~212 usos que chaveiam por ele continuam intactos) e **inverter** — o SIGTAP real ganha um campo novo.

### Modelo de dados (procedimentos e pactuações)
| Campo | Comum | Especializada | Papel |
|---|---|---|---|
| `sigtap` | `0301010072` | `0301010030-CARD` | **identidade** (chave de ligação/agrupamento) |
| `codigoFaturamento` | `0301010072` | `0301010030` | SIGTAP **real**, só dígitos (faturamento/conferência) |
| `variante` | — | `CARD` | sufixo curto da especialidade |
| `especialidade` | — | `Cardiologia` | nome para exibição |

Procedimento comum = `variante` vazio → **idêntico ao comportamento antigo**.

### Pontos-chave do código
- **[business-rules.js](src/js/business-rules.js)**: `normalizarCodigo` (preserva letras — NÃO usar `replace(/\D/g,'')` para agrupar) + `codigoExibicao`; `chaveOfertaRede` usa `normalizarCodigo` → variantes não se fundem na oferta da rede.
- **[acompanhamento-logic.js](src/js/acompanhamento-logic.js)** e **[acompanhamento-inst-logic.js](src/js/acompanhamento-inst-logic.js)**: todos os `cleanSigtap`/strips passaram a preservar o sufixo (via `normalizarCodigo`).
- **[repository.js](src/js/repository.js)** (`importData`): lê a coluna **Especialidade** (aceita nome OU código curto, com fallback derivado); monta o `sigtap` composto; grava `codigoFaturamento`/`variante`/`especialidade`. **O ID composto da pactuação usa o `sigtap` composto** → especialidades do mesmo código real não colidem. `savePactuacao`/`duplicateCompetencia`/`saveJustificativa` já usam `pact.sigtap` (agora composto) — consistentes sem mudança.
- **[configuracao.html](configuracao.html)**: lista de especialidades em `config/system` (`especialidades: [{codigo, nome}]`), semeada com **41** padrões; gerenciador próprio (botão **Especialidades** → add/editar/excluir, valida código único); campo **Especialidade** no cadastro de procedimento (dropdown + **"Outra"** on-the-fly) + **preview** do código final. Campo SIGTAP continua só-dígitos (= `codigoFaturamento`).
- **[dashboard-logic.js](src/js/dashboard-logic.js)**: detalhe e tabela exibem o nome da especialidade + o SIGTAP real ao lado.
- **[modelo_importacao.csv](modelo_importacao.csv)**: coluna **Especialidade** + 2 linhas de exemplo (mesmo código real, variantes diferentes).

### Sem migração
Dados eram só de teste → **recriar** com a coluna Especialidade. Nenhum script de migração.

### Pendências / atenção
- **Códigos curtos propostos** (`CIRCABP`, `GINOBST`, `CIRCARDV`…): revisar no gerenciador; garanti só que não repetem.
- **Matching no import por nome**: nome muito abreviado/diferente do cadastrado não casa → vira código derivado. Conferir a lista antes de importar em massa (ou usar o código curto direto no CSV).
- A **auditoria SIGTAP** foi verificada: tolera o composto (parte de dígitos = 10; `id === sigtap`) e não corrompe especializados — deixada intacta.
