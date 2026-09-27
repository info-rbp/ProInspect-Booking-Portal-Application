import { GoogleAuth } from 'google-auth-library';
import type {
  AddressSuggestion,
  AddressValidationResult,
  PropertyDetails,
} from '../types/booking.js';

type GoogleAddressComponent = {
  componentName?: { text?: string };
  componentType?: string;
  confirmationLevel?: string;
};

type GoogleValidationResponse = {
  result?: {
    verdict?: {
      validationGranularity?: string;
      addressComplete?: boolean;
      possibleNextAction?: string;
    };
    address?: {
      formattedAddress?: string;
      addressComponents?: GoogleAddressComponent[];
    };
    geocode?: {
      location?: {
        latitude?: number;
        longitude?: number;
      };
      placeId?: string;
    };
  };
};

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
};

let authClientPromise: Promise<any> | null = null;

export function addressValidationMode(): 'off' | 'optional' | 'required' {
  const configured = (process.env.ADDRESS_VALIDATION_MODE || 'optional')
    .trim()
    .toLowerCase();

  if (configured === 'off' || configured === 'required') return configured;
  return 'optional';
}

async function mapsHeaders(fieldMask?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (apiKey) {
    headers['X-Goog-Api-Key'] = apiKey;
  } else {
    if (!authClientPromise) {
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      authClientPromise = auth.getClient();
    }

    const client = await authClientPromise;
    const tokenResult = await client.getAccessToken();
    const token =
      typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;

    if (!token) {
      throw new Error('Google Maps Platform authentication did not return an access token.');
    }

    headers.Authorization = `Bearer ${token}`;

    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    if (projectId) headers['X-Goog-User-Project'] = projectId;
  }

  if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask;
  return headers;
}

export async function autocompleteAustralianAddress(
  input: string
): Promise<AddressSuggestion[]> {
  if (addressValidationMode() === 'off') return [];

  const query = input.trim();
  if (query.length < 3) return [];

  const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: await mapsHeaders(
      [
        'suggestions.placePrediction.placeId',
        'suggestions.placePrediction.text.text',
        'suggestions.placePrediction.structuredFormat.mainText.text',
        'suggestions.placePrediction.structuredFormat.secondaryText.text',
      ].join(',')
    ),
    body: JSON.stringify({
      input: query,
      includedRegionCodes: ['au'],
      regionCode: 'au',
      languageCode: 'en',
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Google Places autocomplete failed with status ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`
    );
  }

  const data = (await response.json()) as GoogleAutocompleteResponse;

  return (data.suggestions || [])
    .map((item): AddressSuggestion | null => {
      const prediction = item.placePrediction;
      const placeId = prediction?.placeId?.trim();
      const text = prediction?.text?.text?.trim();

      if (!placeId || !text) return null;

      return {
        placeId,
        text,
        mainText: prediction?.structuredFormat?.mainText?.text?.trim() || undefined,
        secondaryText:
          prediction?.structuredFormat?.secondaryText?.text?.trim() || undefined,
      };
    })
    .filter((item): item is AddressSuggestion => Boolean(item))
    .slice(0, 6);
}

function componentText(
  components: GoogleAddressComponent[] | undefined,
  type: string
): string {
  return (
    components?.find((component) => component.componentType === type)?.componentName?.text?.trim() ||
    ''
  );
}

export async function validateAustralianAddress(input: {
  formattedAddress?: string;
  property?: Partial<PropertyDetails>;
}): Promise<AddressValidationResult> {
  if (addressValidationMode() === 'off') {
    return {
      verified: false,
      requiresConfirmation: false,
      message: 'Address validation is disabled.',
    };
  }

  const property = input.property || {};
  const formattedAddress = input.formattedAddress?.trim();

  const addressLines = formattedAddress
    ? [formattedAddress]
    : [
        [property.unit, property.streetAddress].filter(Boolean).join(' ').trim(),
        [property.suburb, property.state, property.postcode].filter(Boolean).join(' ').trim(),
      ].filter(Boolean);

  if (addressLines.length === 0) {
    return {
      verified: false,
      requiresConfirmation: false,
      message: 'Enter a property address to validate.',
    };
  }

  const response = await fetch(
    'https://addressvalidation.googleapis.com/v1:validateAddress',
    {
      method: 'POST',
      headers: await mapsHeaders(),
      body: JSON.stringify({
        address: {
          regionCode: 'AU',
          languageCode: 'en',
          addressLines,
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Google Address Validation failed with status ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`
    );
  }

  const data = (await response.json()) as GoogleValidationResponse;
  const result = data.result;
  const verdict = result?.verdict;
  const components = result?.address?.addressComponents;
  const validationGranularity = verdict?.validationGranularity || '';
  const addressComplete = verdict?.addressComplete === true;
  const possibleNextAction = verdict?.possibleNextAction || '';

  const streetNumber = componentText(components, 'street_number');
  const route = componentText(components, 'route');
  const unit =
    componentText(components, 'subpremise') ||
    componentText(components, 'subpremise_number');
  const suburb =
    componentText(components, 'locality') ||
    componentText(components, 'sublocality') ||
    componentText(components, 'postal_town');
  const state = componentText(components, 'administrative_area_level_1');
  const postcode = componentText(components, 'postal_code');

  const premiseLevel = ['PREMISE', 'SUB_PREMISE'].includes(validationGranularity);
  const needsFix = possibleNextAction === 'FIX';
  const verified = addressComplete && premiseLevel && !needsFix;
  const requiresConfirmation =
    verified && Boolean(possibleNextAction) && possibleNextAction !== 'ACCEPT';

  let message: string | undefined;
  if (!addressComplete) {
    message = 'Google could not confirm the address as complete. Check the street, suburb and postcode.';
  } else if (!premiseLevel) {
    message = 'Google could not confirm this address to a specific property or premises.';
  } else if (needsFix) {
    message = 'Google identified address details that need correction.';
  } else if (requiresConfirmation) {
    message = 'Google standardized this address. Review the suggested address before continuing.';
  }

  return {
    verified,
    requiresConfirmation,
    message,
    formattedAddress: result?.address?.formattedAddress?.trim() || undefined,
    placeId: result?.geocode?.placeId?.trim() || undefined,
    latitude: result?.geocode?.location?.latitude,
    longitude: result?.geocode?.location?.longitude,
    validationGranularity: validationGranularity || undefined,
    possibleNextAction: possibleNextAction || undefined,
    addressComplete,
    streetAddress: [streetNumber, route].filter(Boolean).join(' ') || undefined,
    unit: unit || undefined,
    suburb: suburb || undefined,
    state: state || undefined,
    postcode: postcode || undefined,
  };
}
