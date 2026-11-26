# ADR-0001: Registrar decisões de arquitetura em ADRs

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

O projeto é de estudo e vai passar por 22 dias de trabalho, feitos em boa parte pelo Claude Code
em sessões que não lembram umas das outras. Sem um registro, a mesma decisão é rediscutida e o
motivo de cada escolha se perde.

## Decisão

Toda decisão que muda a estrutura do sistema, um contrato entre serviços ou uma ferramenta central
vira um ADR em `docs/adr/NNNN-titulo.md`, no formato de Michael Nygard: contexto, decisão,
consequências e alternativas. ADRs são imutáveis depois de aceitos; mudar de ideia é um novo ADR que
marca o anterior como "Substituído por ADR-NNNN".

A skill `.claude/skills/adr` ensina o Claude Code a criar ADRs nesse formato, e a página
**Arquitetura** do frontend lista todos eles.

## Consequências

- Cada PR que toma uma decisão dessas inclui o ADR; o code review confere.
- Um ADR curto é melhor que nenhum: uma página no máximo.

## Alternativas consideradas

- **Só o README:** mistura o "como usar" com o "por que é assim" e cresce sem estrutura.
- **Wiki do GitHub:** fica fora do PR, então a decisão e o código não são revisados juntos.
