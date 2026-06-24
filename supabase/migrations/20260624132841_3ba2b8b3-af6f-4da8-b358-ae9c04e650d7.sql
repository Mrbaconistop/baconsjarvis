
CREATE POLICY "Users read own files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users upload own files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users update own files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = auth.uid()::text);
