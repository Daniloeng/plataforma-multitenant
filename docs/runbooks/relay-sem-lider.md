# RelaySemLider / RelayComDoisLideres

**Dispara quando:** nenhuma réplica de um serviço publica o outbox há 1 min, ou mais de uma publica
(`sum by (job) (plataforma_outbox_relay_lider)` diferente de 1). O lease fica na coleção
`outbox_relay_lease` da database padrão do serviço (ADR-0015), com validade de 10 s.

## Diagnóstico
1. `docker compose -f infra/docker-compose.yml exec mongo-<serviço> mongosh <db> --quiet --eval 'db.outbox_relay_lease.find()'`: quem é a
   dona e até quando (`expiresAt`)?
2. Sem líder: as réplicas estão no ar? O MongoDB aceita escrita? Logs com "assumiu o relay" ou
   "perdeu o relay".
3. Dois líderes: diferença de relógio entre réplicas maior que a validade, ou uma réplica travada
   (GC longo) que voltou achando que ainda é dona. Ela percebe na próxima renovação.

## Ação
- Sem líder por MongoDB fora: restabeleça; a primeira réplica que conseguir escrever assume.
- Dois líderes por mais de 1 min: reinicie a réplica que não é a dona do documento. Eventos em dobro
  são descartados pelos consumidores (eventId), mas a ordem por agregado pode sofrer.
