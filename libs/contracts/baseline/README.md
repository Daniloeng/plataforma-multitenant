# Baseline dos schemas publicados

Cópia dos schemas Avro como estavam na última versão publicada (tag `dia-02`). O teste
`BaselineCompatibilityTest` exige que cada schema atual em `src/main/avro` continue **BACKWARD
compatível** com o seu baseline: um consumidor com o schema novo lê mensagens antigas.

Ao publicar uma versão com schemas alterados, atualize esta pasta copiando `src/main/avro`.
Uma mudança incompatível exige um novo tópico (`.v2`) e um novo record, nunca a edição do atual.
