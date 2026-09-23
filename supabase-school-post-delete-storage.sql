-- 글 삭제 후에도 작성자가 자신이 올린 첨부파일을 Storage API로 정리할 수 있게 합니다.
-- SELECT 권한은 Storage의 일괄 삭제 작업에만 적용되어 파일 열람 범위를 넓히지 않습니다.
begin;

drop policy if exists "authors select own resources for deletion" on storage.objects;
create policy "authors select own resources for deletion"
on storage.objects for select to authenticated
using (
  bucket_id = 'school-resources'
  and owner_id = auth.uid()::text
  and storage.allow_only_operation('object.delete_many')
);

commit;
