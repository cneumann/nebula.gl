// @flow
/* eslint-env browser */

import { parse as parseWkt } from 'wellknown';
import { kml } from '@tmcw/togeojson';
// If we want to support node -- we need to import xmldom.
// For now, we're only supporting browser so we can leave it out.
// import { DOMParser } from 'xmldom';
import { newFeatureId } from '../utils.js';
import type { AnyGeoJson, GeoJsonFeature } from '../types.js';

export type ValidImportData = {
  valid: true,
  type: 'GeoJSON' | 'KML' | 'WKT',
  features: GeoJsonFeature[]
};

export type InvalidImportData = {
  valid: false,
  validationErrors: string[]
};

export type ImportData = ValidImportData | InvalidImportData;

function shouldTryGeoJson(data: string): boolean {
  return data.startsWith('{');
}

function shouldTryKml(data: string): boolean {
  return data.startsWith('<');
}

function shouldTryWkt(data: string): boolean {
  return (
    data.startsWith('POINT') ||
    data.startsWith('LINESTRING') ||
    data.startsWith('POLYGON') ||
    data.startsWith('MULTIPOINT') ||
    data.startsWith('MULTILINESTRING') ||
    data.startsWith('MULTIPOLYGON')
  );
}

function getCleanedFeatures(geojson: AnyGeoJson): GeoJsonFeature[] {
  if (geojson.type !== 'FeatureCollection' && geojson.type !== 'Feature') {
    throw Error(`GeoJSON must have type of 'Feature' or 'FeatureCollection'`);
  }

  const features: GeoJsonFeature[] =
    geojson.type === 'FeatureCollection' ? geojson.features : [geojson];

  return features.map(getCleanedFeature);
}

function getCleanedFeature(feature: GeoJsonFeature): GeoJsonFeature {
  let geometry = feature.geometry;
  // reduce null-checking
  const properties = feature.properties || {};

  if (geometry.type === 'GeometryCollection' && geometry.geometries.length === 1) {
    // There's only one geometry
    geometry = geometry.geometries[0];
  } else if (geometry.type === 'GeometryCollection' && geometry.geometries.length > 1) {
    const types = new Set(geometry.geometries.map(g => g.type));
    if (types.size === 1) {
      // See if it can be combined into a Multi* geometry
      const type = types.values().next().value;
      if (type === 'Polygon') {
        // Combine all the polygons into a single MultiPolygon
        geometry = {
          type: 'MultiPolygon',
          coordinates: geometry.geometries.map(g => g.coordinates)
        };
      } else if (type === 'LineString') {
        // Combine all the polygons into a single MultiPolygon
        geometry = {
          type: 'MultiLineString',
          coordinates: geometry.geometries.map(g => g.coordinates)
        };
      }
    } else {
      // Mixed geometry types, we don't yet handle it
      throw Error('GeometryCollection geometry type not yet supported');
    }
  }

  return {
    type: 'Feature',
    geometry,
    properties,
    id: newFeatureId()
  };
}

function parseImportString(data: string): Promise<ImportData> {
  data = data.trim();
  let validData: ?ValidImportData;
  const validationErrors: string[] = [];
  if (shouldTryGeoJson(data)) {
    // Parse as GeoJSON
    try {
      const parsed = JSON.parse(data);
      validData = {
        valid: true,
        type: 'GeoJSON',
        features: getCleanedFeatures(parsed)
      };
    } catch (err) {
      validationErrors.push('Error parsing GeoJSON');
      validationErrors.push(err.toString());
    }
  } else if (shouldTryKml(data)) {
    // Parse as KML
    const xml = new DOMParser().parseFromString(data, 'text/xml');

    try {
      const parsed = kml(xml);
      const isFeature = parsed && parsed.type === 'Feature';
      const isFeatureCollectionWithFeatures =
        parsed && parsed.type === 'FeatureCollection' && parsed.features.length > 0;
      const isValid = isFeature || isFeatureCollectionWithFeatures;
      if (isValid) {
        validData = {
          valid: true,
          type: 'KML',
          features: getCleanedFeatures(parsed)
        };
      } else {
        validationErrors.push('Invalid KML');
      }
    } catch (err) {
      validationErrors.push('Error parsing KML');
      validationErrors.push(err.toString());
    }
  } else if (shouldTryWkt(data)) {
    try {
      const parsed = parseWkt(data);
      if (parsed) {
        validData = {
          valid: true,
          type: 'WKT',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: parsed,
              id: newFeatureId()
            }
          ]
        };
      } else {
        validationErrors.push('Invalid WKT');
      }
    } catch (err) {
      validationErrors.push('Error parsing WKT');
      validationErrors.push(err.toString());
    }
  } else {
    validationErrors.push('Unknown data format');
  }

  if (validData) {
    return Promise.resolve(validData);
  }
  return Promise.resolve({
    valid: false,
    validationErrors
  });
}

function parseImportFile(file: File): Promise<ImportData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const fileAsString: any = reader.result;
      resolve(parseImportString(fileAsString));
    };
    reader.onabort = () => {
      reject(Error('file reading was aborted'));
    };
    reader.onerror = () => {
      reject(Error('file reading has failed'));
    };

    reader.readAsText(file);
  });
}

export function parseImport(data: string | File): Promise<ImportData> {
  if (typeof data === 'string') {
    return parseImportString(data);
  }
  return parseImportFile(data);
}