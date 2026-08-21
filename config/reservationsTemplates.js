export const RESERVATIONS_TEMPLATES = Object.freeze({
  general: { label: 'General appointments', businessType: 'general', fields: [] },
  physiotherapy: { label: 'Physiotherapy', businessType: 'physiotherapy', fields: [
    ['Main concern','textarea',null,true], ['Affected region','text',null,false], ['First visit?','dropdown',['Yes','No'],false], ['Preferred therapist','text',null,false], ['Pain level','dropdown',['1 - Lowest','2','3','4','5','6','7','8','9','10 - Highest'],false],
  ]},
  dental: { label: 'Dental clinic', businessType: 'dental', fields: [
    ['Reason for visit','textarea',null,true], ['Procedure','dropdown',['Check-up','Cleaning','Filling','Extraction','Emergency','Other'],false], ['First visit?','dropdown',['Yes','No'],false],
  ]},
  salon: { label: 'Salon / beauty', businessType: 'salon', fields: [
    ['Requested service','text',null,true], ['Preferred stylist','text',null,false], ['First visit?','dropdown',['Yes','No'],false],
  ]},
  learning_centre: { label: 'Learning centre', businessType: 'learning_centre', fields: [
    ['Student name','text',null,true], ['Age / year level','text',null,false], ['Subject or programme','text',null,true], ['First visit?','dropdown',['Yes','No'],false],
  ]},
  restaurant: { label: 'Restaurant', businessType: 'restaurant', fields: [
    ['Special requests','textarea',null,false],
  ]},
});

export const DEFAULT_RESERVATIONS_TEMPLATE = 'general';
export const isReservationsTemplate = value => Object.hasOwn(RESERVATIONS_TEMPLATES, value);
export const getReservationsTemplate = value => RESERVATIONS_TEMPLATES[value] || RESERVATIONS_TEMPLATES[DEFAULT_RESERVATIONS_TEMPLATE];
export const listReservationsTemplates = () => Object.entries(RESERVATIONS_TEMPLATES).map(([value, template]) => ({ value, label: template.label, businessType: template.businessType }));
