/* Supabase 連線設定。
   publishable key 是設計上就公開的——前端一定要送給瀏覽器，藏不住也不必藏，
   隱私由 RLS 扛。sb_secret_ 那把才是永不進 repo 的。 */

export const SUPABASE_URL = 'https://bpnucfejoiazmsnsuzdb.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_6BS_QZ-T9tPU6Oe74yHj2Q_6uF-2oWF'
