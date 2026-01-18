# Documentação Técnica: Página de Lançamento de Incentivos

Esta documentação detalha a estrutura de backend e as lógicas de cálculo implementadas na página de Lançamento de Ofertas (`lancamento.html` e `src/js/lancamento-logic.js`).

## 1. Visão Geral

A página permite que os Institutos visualizem suas metas pactuadas e lancem a produção realizada (oferta) para cada procedimento. O sistema agrupa múltiplos programas sob um mesmo código SIGTAP para simplificar a visualização e o lançamento.

## 2. Backend (Firebase Firestore)

O sistema utiliza o **Firebase Firestore** como banco de dados NoSQL. A principal coleção utilizada nesta página é a `pactuacoes`.

### Coleção: `pactuacoes`
Esta coleção armazena a relação entre Programas, Institutos e Procedimentos para uma determinada competência (mês).

*   **ID do Documento (Composite Key):** `progId_instId_sigtap_competencia`
    *   Exemplo: `programa_cirurgias_hosp_central_0401010101_2023-10`
    *   Isso garante unicidade para cada combinação.

*   **Campos Principais:**
    *   `progId` (String): ID do Programa (ex: Tabela Unificada, Incentivo X).
    *   `instId` (String): ID do Instituto.
    *   `sigtap` (String): Código do procedimento (10 dígitos).
    *   `competencia` (String): Mês de referência (ex: "2023-10").
    *   `ofertaMinima` (Number): A meta pactuada para este item específico.
    *   `producao` (Map): Objeto que armazena os dados de produção/lançamento.
        *   `realizada` (Number): O valor lançado pelo usuário (quantidade ofertada).
    *   `vlrSigtapBase` (Number): Valor unitário base.
    *   `vlrIncentivo` (Number): Valor do incentivo.

### Outras Coleções Relacionadas
*   `institutos`: Dados cadastrais dos institutos.
*   `procedimentos`: Detalhes dos procedimentos (Nome, Valor Base).
*   `programas`: Nomes dos programas.

## 3. Lógica de Agrupamento e Cálculos (Frontend)

O frontend (`src/js/lancamento-logic.js`) realiza um processamento dos dados brutos vindos do Firebase para exibir a tabela unificada.

### 3.1. Agrupamento (Grouping)
Os registros da coleção `pactuacoes` são filtrados pelo Instituto logado e pela Competência selecionada. Em seguida, eles são **agrupados pelo código SIGTAP**.

Isso significa que se um procedimento (ex: "Consulta em Cardiologia") faz parte de 3 programas diferentes para o mesmo instituto, eles aparecerão como **uma única linha** na tabela principal.

### 3.2. Cálculo da Meta (Coluna "Meta")
A meta exibida na tabela principal segue uma lógica específica definida como "Considerar a da maior":

*   **Lógica:** O sistema percorre todos os itens do grupo (mesmo SIGTAP) e identifica o **maior valor** de `ofertaMinima`.
*   **Código:**
    ```javascript
    if (meta > groups[p.sigtap].maxMeta) groups[p.sigtap].maxMeta = meta;
    ```
*   **Exibição:** O valor `maxMeta` é exibido na coluna "Meta" e usado como denominador para calcular a barra de progresso.

### 3.3. Cálculo do Realizado (Coluna "Oferta (Qtd)" e Progresso)
O valor realizado também é unificado para o grupo.

*   **Lógica:** O sistema busca o **maior valor** encontrado em `producao.realizada` entre os itens do grupo.
*   **Código:**
    ```javascript
    groups[p.sigtap].totalRealizado = Math.max(groups[p.sigtap].totalRealizado, real);
    ```
*   **Barra de Progresso:**
    *   Fórmula: `(totalRealizado / maxMeta) * 100`
    *   Cores:
        *   **Verde:** >= 100%
        *   **Amarelo:** < 50%
        *   **Azul (Primary):** Entre 50% e 99%

### 3.4. Lógica de Atualização (Input do Usuário)
Quando o usuário digita um novo valor na tabela principal:

1.  O evento `onchange` dispara a função `window.updateOffer`.
2.  O sistema identifica o grupo pelo SIGTAP.
3.  **Replicação:** O novo valor digitado é aplicado ao campo `producao.realizada` de **todos** os itens (programas) que compõem aquele grupo.
    *   Isso garante que, ao lançar a oferta para o procedimento, todos os programas vinculados recebam a mesma informação de produção realizada.
4.  A tabela é renderizada novamente ("Optimistic UI update") para refletir as mudanças imediatamente.

## 4. Detalhamento (Modal)
Ao clicar no ícone de "olho" (Detalhes), o usuário vê a quebra por Programa.
*   Neste modal, cada linha representa um item individual da coleção `pactuacoes`.
*   Aqui, a `Meta` é o valor individual (`ofertaMinima`) daquele programa específico, permitindo conferir as metas parciais.

## 5. Resumo do Fluxo
1.  **Load:** Busca `pactuacoes` do Firebase.
2.  **Filter:** Filtra por `instId` e `competencia`.
3.  **Group:** Agrupa por `sigtap`.
    *   Calcula `maxMeta` (Maior meta entre os programas do grupo).
    *   Calcula `totalRealizado` (Maior realizado entre os programas).
4.  **Render:** Exibe tabela unificada.
5.  **Update:** Ao alterar valor, atualiza `producao.realizada` em **todos** os objetos do grupo na memória (e posteriormente persistiria no banco).
