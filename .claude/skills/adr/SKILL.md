---
name: adr
description: Cria um ADR (Architecture Decision Record) no formato do projeto em docs/adr/. Use quando uma mudança toma uma decisão de arquitetura, de contrato entre serviços ou de ferramenta central, ou quando pedirem para registrar uma decisão.
---

# Criar um ADR

1. **Descubra o próximo número:** liste `docs/adr/` e use o maior `NNNN` + 1, com quatro dígitos.
2. **Nome do arquivo:** `docs/adr/NNNN-titulo-em-kebab-case.md`, título curto e sem acentos no nome
   do arquivo (o título dentro do arquivo leva acentos).
3. **Conteúdo, em português do Brasil, no máximo uma página:**

   ```markdown
   # ADR-NNNN: Título da decisão

   - **Status:** Proposto | Aceito | Substituído por ADR-XXXX
   - **Data:** AAAA-MM-DD

   ## Contexto
   O problema e as forças em jogo (requisitos, custo, prazo). Sem a solução ainda.

   ## Decisão
   O que foi decidido, em frases afirmativas ("Usamos...", "Todo serviço...").

   ## Consequências
   O que fica mais fácil, o que fica mais difícil e o que passa a ser obrigatório.

   ## Alternativas consideradas
   - **Alternativa:** por que não foi escolhida.
   ```

   As duas linhas de Status e Data logo abaixo do título são lidas pela página **Arquitetura** do
   frontend: mantenha exatamente esse formato.
4. **ADR aceito não se edita.** Para mudar uma decisão, crie um novo ADR e altere só a linha de
   Status do antigo para `Substituído por ADR-NNNN`.
5. **Ligue o ADR ao resto:** cite-o no PR, e no `CLAUDE.md` se ele criar uma regra que o Claude
   deve seguir sempre.
6. **Peça revisão:** rode o subagente `arquiteto` sobre o ADR e a mudança que ele justifica.
