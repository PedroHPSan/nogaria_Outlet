-- Tamanho (numeração) para calçados — texto livre, opcional.
-- Ex.: "42", "38 BR", "M". Fica em branco para itens que não são calçado.
-- Exibido na UI só quando o grupo é "Calçados"; ajuda a montar a oferta/anúncio.
alter table itens add column if not exists tamanho text;
