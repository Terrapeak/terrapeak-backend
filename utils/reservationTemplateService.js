import { createClient } from '@supabase/supabase-js';
import { getReservationsTemplate } from '../config/reservationsTemplates.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function applyReservationsTemplate({ businessId, templateKey }) {
  const template = getReservationsTemplate(templateKey);
  const { data: existing, error: loadError } = await supabase.from('booking_custom_fields').select('id,field_label,system_key,is_active').eq('business_id', businessId);
  if (loadError) throw new Error('Could not load Customer Form fields for template provisioning');
  const labels = new Set((existing || []).map(field => String(field.field_label || '').trim().toLowerCase()));
  const systemFields = [
    { field_label:'Full name', field_type:'text', is_required:true, is_locked:true, system_key:'customer_name', display_order:10 },
    { field_label:'Phone', field_type:'text', is_required:true, is_locked:true, system_key:'customer_phone', display_order:20 },
    { field_label:'Email', field_type:'text', is_required:false, is_locked:false, system_key:'customer_email', display_order:30 },
  ];
  const defaults = [...systemFields, ...template.fields.map(([label,type,options,required], index) => ({ field_label:label, field_type:type, field_options:Array.isArray(options)?options.join('\n'):null, is_required:required, is_locked:false, system_key:null, display_order:40+(index*10) }))];
  const missing = defaults.filter(field => !labels.has(field.field_label.toLowerCase())).map(field => ({ business_id:businessId, is_active:true, ...field }));
  if (missing.length) {
    const { error } = await supabase.from('booking_custom_fields').insert(missing);
    if (error) throw new Error('Could not apply Customer Form template');
  }
  return { templateKey, businessType:template.businessType, addedFields:missing.length, preservedFields:(existing || []).length };
}
