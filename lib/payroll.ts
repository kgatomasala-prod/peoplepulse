// ============================================================
// PeoplePulse — BURS-Compliant Payroll Engine
// Botswana Employment & Tax Law
// Financial Year: 1 July – 30 June | Currency: P | Dates: DD/MM/YYYY
// ============================================================

import type { TaxBand, PayComponent, PayComponentAssignment, Employee } from "@prisma/client";

// ---------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------

export type PayrollInput = {
  basicSalary: number;
  allowances: PayComponentAssignment[];
  overtimeHours: number;
  bonusPay: number;
  preTaxPension: number;
  preTaxMedicalAid: number;
  postTaxDeductions: number;
  employerPensionRate: number; // e.g. 10 for 10%
};

export type PayrollResult = {
  grossPay: number;
  taxableIncome: number;
  paye: number;
  sdl: number;
  netPay: number;
  employerPension: number;
  employerCost: number;
  // Special calculations
  severancePay: number;
  severanceTaxExempt: number;
  leaveEncashment: number;
  proRataPay: number;
  // YTD inputs needed
  ytdGross: number;
  ytdPaye: number;
  ytdNet: number;
};

export type TaxBandInput = {
  bandMin: number;
  bandMax: number | null;
  ratePercent: number;
  cumulativeTaxBelow: number;
};

export type SeveranceResult = {
  daysOwed: number;
  grossSeverance: number;
  taxExemptAmount: number;
  taxableSeverance: number;
};

// ---------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------

/** Botswana minimum wage per hour (P7.34/hr as of 2025) */
export const MIN_WAGE_PER_HOUR = 7.34;

/** SDL rate — 0.2% of gross */
export const SDL_RATE = 0.002;

/** SDL exempt threshold — companies with turnover < P250,000/year */
export const SDL_EXEMPT_THRESHOLD = 250_000;

/** Standard working days per month (for pro-rata) */
export const WORKING_DAYS_PER_MONTH = 26;

/** Days per year for leave encashment (260 = 52 weeks × 5 days) */
export const DAYS_PER_YEAR = 260;

/** Overtime rate multiplier */
export const OVERTIME_MULTIPLIER = 1.5;

/** Standard notice period in months */
export const STANDARD_NOTICE_PERIOD_MONTHS = 1;

// ---------------------------------------------------------------
// GROSS PAY CALCULATION
// ---------------------------------------------------------------

/**
 * GROSS = Basic Salary + Allowances + Overtime + Bonus
 * Overtime = overtimeHours × (basicSalary / workingDaysInMonth / 8) × 1.5
 */
export function calculateGrossPay(input: PayrollInput): number {
  const basic = input.basicSalary;
  const totalAllowances = input.allowances
    .filter((a) => a.payComponent && a.payComponent.type === "EARNING")
    .reduce((sum, a) => sum + a.amount, 0);
  const hourlyRate = basic / WORKING_DAYS_PER_MONTH / 8;
  const overtimePay = input.overtimeHours * hourlyRate * OVERTIME_MULTIPLIER;
  const bonus = input.bonusPay;

  return basic + totalAllowances + overtimePay + bonus;
}

// ---------------------------------------------------------------
// PAYE TAX CALCULATION — 5-Band BURS Table (2025 Resident)
// ---------------------------------------------------------------

/**
 * Annualize taxable income → apply tax bands → de-annualize to monthly
 *
 * Resident 2025 Bands:
 *   P0     – P48,000   → 0%
 *   P48,001 – P84,000  → 5%   (cumulative tax P1,800)
 *   P84,001 – P120,000 → 12.5%(cumulative tax P6,300)
 *   P120,001– P156,000 → 18.75%(cumulative tax P13,050)
 *   Above P156,000     → 25%  (+ 25% on excess)
 *
 * Non-Resident: No zero-rate band — 5% from first Pula
 */
export function calculateMonthlyPaye(
  monthlyTaxableIncome: number,
  taxBands: TaxBandInput[],
  isResident: boolean
): number {
  if (monthlyTaxableIncome <= 0) return 0;

  // Annualize
  const annualTaxable = monthlyTaxableIncome * 12;

  // Apply tax bands
  const annualTax = calculateAnnualTax(annualTaxable, taxBands, isResident);

  // De-annualize back to monthly
  return Math.round(annualTax / 12);
}

function calculateAnnualTax(
  annualTaxable: number,
  taxBands: TaxBandInput[],
  isResident: boolean
): number {
  // Sort bands by bandMin
  const sorted = [...taxBands].sort((a, b) => a.bandMin - b.bandMin);

  if (!isResident) {
    // Non-resident: linear 5% from P1 — use simple calculation
    // Non-resident bands start at 5% from the first Pula
    return applyNonResidentTax(annualTaxable, sorted);
  }

  return applyResidentTax(annualTaxable, sorted);
}

function applyResidentTax(annualTaxable: number, bands: TaxBandInput[]): number {
  let tax = 0;
  let remaining = annualTaxable;

  for (const band of bands) {
    if (remaining <= 0) break;

    const bandSize = band.bandMax !== null
      ? band.bandMax - band.bandMin + 1
      : Infinity;

    if (annualTaxable <= band.bandMax || band.bandMax === null) {
      // Income falls in this band
      if (band.cumulativeTaxBelow > 0) {
        // Use cumulative tax approach for middle bands
        tax = band.cumulativeTaxBelow + (annualTaxable - band.bandMin + 1) * (band.ratePercent / 100);
      } else if (band.ratePercent === 0) {
        // Zero rate band
        tax = 0;
      } else {
        // Top band — 25% on everything above band min
        tax = band.cumulativeTaxBelow + (annualTaxable - band.bandMin) * (band.ratePercent / 100);
      }
      break;
    } else {
      // Income exceeds this band — accumulate tax
      if (band.ratePercent === 0) continue;
      // For bands with cumulative tax
      if (band.bandMin === 48001 && annualTaxable > 48000) {
        tax = band.cumulativeTaxBelow + (Math.min(annualTaxable, band.bandMax!) - band.bandMin + 1) * (band.ratePercent / 100);
      } else if (band.bandMin === 84001 && annualTaxable > 84000) {
        tax = band.cumulativeTaxBelow + (Math.min(annualTaxable, band.bandMax!) - band.bandMin + 1) * (band.ratePercent / 100);
      } else if (band.bandMin === 120001 && annualTaxable > 120000) {
        tax = band.cumulativeTaxBelow + (Math.min(annualTaxable, band.bandMax!) - band.bandMin + 1) * (band.ratePercent / 100);
      }
    }
  }

  return Math.round(tax);
}

function applyNonResidentTax(annualTaxable: number, bands: TaxBandInput[]): number {
  // Non-resident: 5% from P1, no zero-rate band
  // Find the appropriate band based on non-resident rates
  let tax = 0;
  let remaining = annualTaxable;

  for (const band of bands) {
    if (remaining <= 0) break;

    const taxableInBand =
      band.bandMax !== null
        ? Math.min(remaining, band.bandMax - band.bandMin + 1)
        : remaining;

    tax += taxableInBand * (band.ratePercent / 100);
    remaining -= taxableInBand;

    if (band.bandMax === null) break;
  }

  return Math.round(tax);
}

// ---------------------------------------------------------------
// SDL (Skills Development Levy)
// ---------------------------------------------------------------

/**
 * SDL = 0.2% of gross pay
 * Exempt if company annual turnover < P250,000
 */
export function calculateSDL(grossPay: number, isSDLExempt: boolean): number {
  if (isSDLExempt) return 0;
  return Math.round(grossPay * SDL_RATE * 100) / 100;
}

// ---------------------------------------------------------------
// EMPLOYER PENSION CONTRIBUTION
// ---------------------------------------------------------------

/**
 * Employer pension = basicSalary × employerPensionRate%
 * Typically 10% for Botswana defined contribution funds
 */
export function calculateEmployerPension(
  basicSalary: number,
  employerPensionRate: number
): number {
  return Math.round(basicSalary * (employerPensionRate / 100) * 100) / 100;
}

// ---------------------------------------------------------------
// NET PAY CALCULATION
// ---------------------------------------------------------------

export function calculateNetPay(
  grossPay: number,
  paye: number,
  sdl: number,
  postTaxDeductions: number
): number {
  return Math.round((grossPay - paye - sdl - postTaxDeductions) * 100) / 100;
}

// ---------------------------------------------------------------
// FULL PAYROLL CALCULATION
// ---------------------------------------------------------------

export function calculatePayroll(
  input: PayrollInput,
  taxBands: TaxBandInput[],
  isResident: boolean,
  isSDLExempt: boolean,
  employerPensionRate: number
): PayrollResult {
  const grossPay = calculateGrossPay(input);

  const preTaxDeductions = input.preTaxPension + input.preTaxMedicalAid;
  const taxableIncome = Math.max(0, grossPay - preTaxDeductions);

  const paye = calculateMonthlyPaye(taxableIncome, taxBands, isResident);
  const sdl = calculateSDL(grossPay, isSDLExempt);
  const postTaxDeductions = input.postTaxDeductions;

  const netPay = calculateNetPay(grossPay, paye, sdl, postTaxDeductions);
  const employerPension = calculateEmployerPension(input.basicSalary, employerPensionRate);
  const employerCost = netPay + employerPension + sdl;

  return {
    grossPay: Math.round(grossPay * 100) / 100,
    taxableIncome: Math.round(taxableIncome * 100) / 100,
    paye: Math.round(paye * 100) / 100,
    sdl: Math.round(sdl * 100) / 100,
    netPay: Math.round(netPay * 100) / 100,
    employerPension: Math.round(employerPension * 100) / 100,
    employerCost: Math.round(employerCost * 100) / 100,
    severancePay: 0,
    severanceTaxExempt: 0,
    leaveEncashment: 0,
    proRataPay: 0,
    ytdGross: 0,
    ytdPaye: 0,
    ytdNet: 0,
  };
}

// ---------------------------------------------------------------
// SEVERANCE PAY — Employment Act Cap.47:01
// Income Tax Amendment Act 2023: 50% tax-exempt
//
// ≤5 years   → 1 day per month of service
// >5 years   → 1 day/month for first 5 years
//            + 1.5 days/month for each month beyond year 5
// ---------------------------------------------------------------

export function calculateSeverance(
  monthlyBasicSalary: number,
  yearsOfService: number,
  monthsOfService: number
): SeveranceResult {
  if (yearsOfService < 0 || monthlyBasicSalary <= 0) {
    return { daysOwed: 0, grossSeverance: 0, taxExemptAmount: 0, taxableSeverance: 0 };
  }

  let daysOwed: number;

  if (yearsOfService <= 5) {
    // 1 day per month
    daysOwed = monthsOfService;
  } else {
    // First 5 years = 60 days, then 1.5 days/month beyond
    const monthsBeyond5 = monthsOfService - 60;
    daysOwed = 60 + Math.floor(monthsBeyond5 * 1.5);
  }

  // Daily rate = annual salary / 260
  const dailyRate = (monthlyBasicSalary * 12) / DAYS_PER_YEAR;
  const grossSeverance = Math.round(daysOwed * dailyRate * 100) / 100;

  // 50% tax-exempt per Income Tax Amendment Act 2023
  const taxExemptAmount = Math.round(grossSeverance * 0.5 * 100) / 100;
  const taxableSeverance = grossSeverance - taxExemptAmount;

  return {
    daysOwed,
    grossSeverance,
    taxExemptAmount,
    taxableSeverance,
  };
}

// ---------------------------------------------------------------
// LEAVE ENCASHMENT
// ---------------------------------------------------------------

/**
 * Leave Encashment = (Annual Salary ÷ 260) × Unused Leave Days
 */
export function calculateLeaveEncashment(
  monthlyBasicSalary: number,
  unusedLeaveDays: number
): number {
  if (unusedLeaveDays <= 0) return 0;
  const dailyRate = (monthlyBasicSalary * 12) / DAYS_PER_YEAR;
  return Math.round(unusedLeaveDays * dailyRate * 100) / 100;
}

// ---------------------------------------------------------------
// PRO-RATA PAY
// ---------------------------------------------------------------

/**
 * Pro-Rata Pay = (Monthly Salary ÷ Working Days in Month) × Days Worked
 */
export function calculateProRata(
  monthlySalary: number,
  workingDaysInMonth: number,
  daysWorked: number
): number {
  if (daysWorked <= 0 || workingDaysInMonth <= 0) return 0;
  const dailyRate = monthlySalary / workingDaysInMonth;
  return Math.round(daysWorked * dailyRate * 100) / 100;
}

// ---------------------------------------------------------------
// MINIMUM WAGE CHECK
// ---------------------------------------------------------------

/**
 * Flag if hourly rate < P7.34
 */
export function checkMinimumWage(
  monthlyBasicSalary: number,
  workingDaysPerMonth: number = WORKING_DAYS_PER_MONTH
): boolean {
  const hourlyRate = monthlyBasicSalary / workingDaysPerMonth / 8;
  return hourlyRate < MIN_WAGE_PER_HOUR;
}

// ---------------------------------------------------------------
// YTD CALCULATIONS (based on financial year 1 July – 30 June)
// ---------------------------------------------------------------

/**
 * Determine current BURS period based on pay date.
 * ITW-7 is filed monthly, due 15th of following month.
 */
export function getCurrentBursPeriod(payDate: Date): { month: number; year: number } {
  const month = payDate.getMonth() + 1; // 1-12
  const year = payDate.getFullYear();
  return { month, year };
}

/**
 * Days remaining in financial year (1 July – 30 June)
 */
export function daysRemainingInFinancialYear(fromDate: Date): number {
  const fyStart = new Date(fromDate.getFullYear(), 6, 1); // 1 July
  const fyEnd = new Date(fromDate.getFullYear() + 1, 5, 30); // 30 June next year

  if (fromDate < fyStart) {
    // We are before 1 July — use current financial year
    return Math.ceil((fyEnd.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  return Math.ceil((fyEnd.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------
// FORMATTING HELPERS
// ---------------------------------------------------------------

/**
 * Format amount as Botswana Pula string: "P1,234.56"
 */
export function formatPula(amount: number): string {
  return `P${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format date as DD/MM/YYYY
 */
export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Parse DD/MM/YYYY string to Date
 */
export function parseDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split("/").map(Number);
  return new Date(year, month - 1, day);
}
