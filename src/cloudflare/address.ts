export function addressValidationMode(){return 'off' as const;}
export async function autocompleteAustralianAddress(){return [];}
export async function validateAustralianAddress(){return {status:'unverified',addressComplete:false,possibleNextAction:'CONFIRM',validationGranularity:'MANUAL',message:'Address entered manually; validate street, suburb, state and postcode before attendance.'};}
