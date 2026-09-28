import useSWR from "swr";
import { openmrsFetch, restBaseUrl } from "@openmrs/esm-framework";
import { CQIReportingCohort } from "./data-visualizer.component";
import dayjs from "dayjs";
import { indicatorIdsWithoutEndPoints } from "./constants";
import { guardRejection } from "../../utils/api-error.utils";

/** openmrsFetch with 401/403 rejections normalized to friendly errors. */
const guardedFetch = (url: string) => guardRejection(openmrsFetch(url));

type ReportRequest = {
  uuid: string;
  startDate: string;
  endDate: string;
  renderType?: string;
  reportCategory?: {
    category: ReportCategory;
    renderType?: RenderType;
  };
  reportingCohort?: CQIReportingCohort;
  parameters?: Record<string, any>;
};

type saveReportRequest = {
  reportName: string;
  reportDescription?: string;
  reportType?: string;
  columns?: string;
  rows: string;
  report_request_object: string;
};

type ReportDownloadParams = {
  uuid: string;
  startDate: string;
  endDate: string;
  /** Download format understood by the reportDownload endpoint: csv, pdf or excel. Defaults to excel server-side. */
  format?: "csv" | "pdf" | "excel";
  reportCategory?: ReportCategory;
  reportingCohort?: CQIReportingCohort;
};

type ReportLibraryCategoryRef = {
  uuid: string;
  display?: string;
  name?: string;
  description?: string;
};

type ReportLibraryItem = {
  uuid: string;
  display?: string;
  name: string;
  description?: string;
  code?: string;
  sourceType?: string;
  reportDefinitionUuid?: string;
  reportBuilderReportUuid?: string;
  reportType?: string;
  migrated?: boolean;
  retired?: boolean;
  category?: ReportLibraryCategoryRef;
  metaJson?: string;
};

type ReportLibraryResponse = {
  data: {
    results: ReportLibraryItem[];
  };
};

type ReportCategoryItem = {
  uuid: string;
  display?: string;
  name: string;
  description?: string;
  retired?: boolean;
};

type ReportCategoryResponse = {
  data: {
    results: ReportCategoryItem[];
  };
};

export async function getReport(params: ReportRequest, signal?: AbortSignal) {
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    uuid: params.uuid,
  });

  // Use renderType from params if provided, otherwise from reportCategory
  const renderType = params.renderType || params.reportCategory?.renderType;
  if (renderType) {
    query.set("renderType", renderType);
  }

  if (params.reportCategory?.category === "cqi" && params.reportingCohort) {
    query.set("cohortList", params.reportingCohort);
  }

  // Add dynamic parameters to query string (for reports with parameters)
  if (params.parameters) {
    Object.entries(params.parameters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });
  }

  return guardRejection(
    openmrsFetch(
      `${restBaseUrl}/reportbuilder/reportingDefinition?${query.toString()}`,
      { signal },
    ),
  );
}

export function downloadReport(params: ReportDownloadParams) {
  const abortController = new AbortController();
  let apiUrl = `${restBaseUrl}/reportbuilder/reportDownload?startDate=${params.startDate}&endDate=${params.endDate}&uuid=${params.uuid}`;
  if (params.format) {
    apiUrl += `&format=${params.format}`;
  }
  if (params.reportCategory === "cqi") {
    apiUrl += `&cohortList=${params.reportingCohort}`;
  }

  return guardRejection(
    openmrsFetch(apiUrl, {
      signal: abortController.signal,
    }),
  );
}

export async function getCategoryIndicator(id: string, type?: string) {
  let apiUrl: string;
  if (id === "IDN") {
    apiUrl = `${restBaseUrl}/patientidentifiertype`;
  } else if (id === "PAT") {
    apiUrl = `${restBaseUrl}/personattributetype`;
  } else if (id === "CON") {
    apiUrl = `${restBaseUrl}/reportbuilder/concepts/conditions`;
  } else if (indicatorIdsWithoutEndPoints.includes(id)) {
    return null;
  } else {
    if (type === "Orders") {
      apiUrl = `${restBaseUrl}/reportbuilder/order/indications?uuid=${id}`;
    } else {
      apiUrl = `${restBaseUrl}/reportbuilder/concepts/encountertype?uuid=${id}`;
    }
  }

  const { data } = await guardRejection(openmrsFetch(apiUrl));
  return data;
}

export function useGetEncounterType() {
  const apiUrl = `${restBaseUrl}/encountertype`;
  const { data, error, isLoading } = useSWR<{ data: { results: any } }, Error>(
    apiUrl,
    guardedFetch
  );
  return {
    encounterTypes: data ? mapDataElements(data?.data["results"]) : [],
    isError: error,
    isLoadingEncounterTypes: isLoading,
  };
}

export function useGetOrderTypes() {
  const apiUrl = `${restBaseUrl}/ordertype?v=custom:(uuid,display,name)`;
  const { data, error, isLoading } = useSWR<{ data: { results: any } }, Error>(
    apiUrl,
    guardedFetch
  );
  return {
    orderTypes: data
      ? mapDataOrderTypeElements(data?.data["results"], "Orders")
      : [],
    isError: error,
    isLoadingOrderTypes: isLoading,
  };
}

export async function saveReport(params: saveReportRequest) {
  const apiUrl = `${restBaseUrl}/dashboardReport`;
  const abortController = new AbortController();

  return guardRejection(
    openmrsFetch(apiUrl, {
      method: "POST",
      signal: abortController.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        name: params.reportName,
        description: params?.reportDescription,
        type: params?.reportType,
        columns: params?.columns,
        rows: params?.rows,
        report_request_object: params.report_request_object,
      },
    }),
  );
}

export async function sendReportToDHIS2(report, dhis2Json) {
  const apiUrl = `${restBaseUrl}/sendreport?uuid=${report}`;
  const abortController = new AbortController();

  return guardRejection(
    openmrsFetch(apiUrl, {
      method: "POST",
      signal: abortController.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        ...dhis2Json,
      },
    }),
  );
}

export async function getCohortCategory(type: string) {
  let apiUrl: string;
  if (type === "patientSearch") {
    apiUrl = `${restBaseUrl}/reportbuilder/patientsearch`;
  } else {
    apiUrl = `${restBaseUrl}/${type}?v=custom:(uuid,name)`;
  }
  const { data } = await guardRejection(openmrsFetch(apiUrl));
  return data;
}

/* report library */

export function useGetReportLibrary() {
  const apiUrl = `${restBaseUrl}/reportbuilder/reportlibrary?v=full`;

  const { data, error, isLoading, mutate } = useSWR<ReportLibraryResponse, Error>(
    apiUrl,
    guardedFetch
  );

  return {
    reportLibrary: data?.data?.results ?? [],
    isError: error,
    isLoadingReportLibrary: isLoading,
    mutate,
  };
}

export function useGetReportCategories() {
  const apiUrl = `${restBaseUrl}/reportbuilder/reportcategory?v=full`;

  const { data, error, isLoading, mutate } = useSWR<ReportCategoryResponse, Error>(
    apiUrl,
    guardedFetch
  );

  return {
    reportCategories: data?.data?.results ?? [],
    isError: error,
    isLoadingReportCategories: isLoading,
    mutate,
  };
}

export const getReportFromRegistry = (
  reportLibrary: ReportLibraryItem[],
  type: string
) => {
  return reportLibrary?.filter(
    (report) =>
      report?.category?.name?.toLowerCase() === type?.toLowerCase() ||
      report?.category?.display?.toLowerCase() === type?.toLowerCase()
  );
};

export const createColumns = (columns: Array<string>) => {
  return columns.map((column: string, index) => ({
    id: `${index}`,
    key: column,
    header: column,
    accessor: column,
  }));
};

export const mapDataOrderTypeElements = (
  dataArray: Array<Record<string, string>>,
  type?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _category?: string
) => {
  if (!dataArray) return [];
  return dataArray.map((ordertype: Record<string, string>) => ({
    id: ordertype.uuid,
    label: ordertype.name + " Indicators",
    type: type,
  }));
};

export const mapDataElements = (
  dataArray: Array<Record<string, string>>,
  type?: string,
  category?: string
) => {
  if (!dataArray) return [];
  if (category === "concepts") {
    return dataArray.map((encounterType: Record<string, string>) => ({
      id: encounterType.uuid,
      label: encounterType.conceptName,
      type: encounterType.type,
      modifier: 1,
      showModifierPanel: false,
      extras: [],
      attributes: [],
    }));
  }
  return dataArray.map((encounterType: Record<string, string>) => ({
    id: encounterType.uuid,
    label: encounterType.display,
    type: type ?? "",
    modifier: 1,
    showModifierPanel: false,
    extras: [],
    attributes: [],
  }));
};

export const mapOrderDataElements = (
  dataArray: Array<string>,
  type?: string,
  category?: string
) => {
  if (!dataArray) return [];
  return dataArray.map((indication: string) => ({
    id: category,
    label: indication,
    type: type,
    modifier: 1,
    showModifierPanel: false,
    extras: [],
    attributes: [],
  }));
};

export const formatReportArray = (selectedItems: Array<Indicator>) => {
  if (!selectedItems) return [];
  return selectedItems.map((item: Indicator) => ({
    label: item.label,
    type: item.type,
    expression: item.id,
    modifier: item?.modifier,
    extras: item?.extras,
  }));
};

export const getDateRange = (selectedPeriod: ReportingPeriod) => {
  const currentDate = new Date();

  switch (selectedPeriod) {
    case "today": {
      return {
        start: currentDate,
        end: currentDate,
      };
    }
    case "week": {
      const startOfWeek = new Date(currentDate);
      startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());

      const endOfWeek = new Date(currentDate);
      endOfWeek.setDate(currentDate.getDate() + (6 - currentDate.getDay()));

      return {
        start: startOfWeek,
        end: endOfWeek,
      };
    }
    case "month": {
      const startOfMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      const endOfMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
      );
      return {
        start: startOfMonth,
        end: endOfMonth,
      };
    }
    case "quarter": {
      const quarter = Math.floor(currentDate.getMonth() / 3);
      const startOfQuarter = new Date(
        currentDate.getFullYear(),
        Math.floor(currentDate.getMonth() / 3) * 3,
        1
      );
      const endOfQuarter = new Date(
        currentDate.getFullYear(),
        (quarter + 1) * 3,
        0
      );
      return {
        start: startOfQuarter,
        end: endOfQuarter,
      };
    }
    case "lastQuarter": {
      const currentQuarter = Math.floor(currentDate.getMonth() / 3) + 1;
      let previousQuarter;
      let previousQuarterYear;

      if (currentQuarter === 1) {
        previousQuarter = 4;
        previousQuarterYear = currentDate.getFullYear() - 1;
      } else {
        previousQuarter = currentQuarter - 1;
        previousQuarterYear = currentDate.getFullYear();
      }

      const startOfPreviousQuarter = new Date(
        previousQuarterYear,
        (previousQuarter - 1) * 3,
        1
      );

      const endOfPreviousQuarter = new Date(
        previousQuarterYear,
        previousQuarter * 3,
        0
      );

      return {
        start: startOfPreviousQuarter,
        end: endOfPreviousQuarter,
      };
    }
    default:
      return {
        start: null,
        end: null,
      };
  }
};

export const extractDate = (timestamp: string): string => {
  const dateObject = new Date(timestamp);
  const year = dateObject.getFullYear();
  const month = (dateObject.getMonth() + 1).toString().padStart(2, "0");
  const day = dateObject.getDate().toString().padStart(2, "0");

  return `${year}-${month}-${day}`;
};

export const formatDate = (date: Date): string => {
  return dayjs(date).format("YYYY-MM-DD");
};
