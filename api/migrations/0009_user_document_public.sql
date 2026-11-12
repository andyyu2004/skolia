-- The public entries in the documents list's order, by key, so a page of them reads no
-- private ones
CREATE INDEX user_document_public_idx ON user_document (user_id, document_id) WHERE visibility = 'public';
