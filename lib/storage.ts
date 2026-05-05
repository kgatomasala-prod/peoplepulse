import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');

/**
 * Storage utility for PeoplePulse
 * Buckets: 'documents', 'payslips', 'logos'
 */
export const storage = {
  uploadFile: async (bucket: string, path: string, file: Buffer | Blob) => {
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: true,
    });
    if (error) throw error;
    return data;
  },

  getPublicUrl: (bucket: string, path: string) => {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  },

  deleteFile: async (bucket: string, path: string) => {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) throw error;
  },
};
