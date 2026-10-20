/**
 * CPF e CNPJ no mesmo campo: quem é pessoa física digita 11 dígitos, empresa
 * digita 14, e o cadastro não precisa perguntar qual é antes.
 */

export function onlyDocumentDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 14);
}

export function formatDocument(value: string) {
  const d = onlyDocumentDigits(value);

  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }

  // Incompleto: devolve o que foi digitado, para não atrapalhar quem ainda
  // está no meio do número.
  return value;
}

export function isValidCpf(value: string) {
  const d = onlyDocumentDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;

  const digit = (upTo: number) => {
    let sum = 0;
    for (let i = 0; i < upTo; i += 1) {
      sum += Number(d[i]) * (upTo + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

export function isValidCnpjDocument(value: string) {
  const d = onlyDocumentDigits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;

  const digit = (upTo: number) => {
    const weights =
      upTo === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < upTo; i += 1) sum += Number(d[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return digit(12) === Number(d[12]) && digit(13) === Number(d[13]);
}

/** Vazio é aceito: o documento só vira obrigatório na hora de emitir a nota. */
export function describeDocumentProblem(value: string) {
  const d = onlyDocumentDigits(value);
  if (!d) return null;
  if (d.length !== 11 && d.length !== 14) {
    return "CPF tem 11 dígitos e CNPJ tem 14.";
  }
  if (d.length === 11 && !isValidCpf(d)) return "CPF inválido.";
  if (d.length === 14 && !isValidCnpjDocument(d)) return "CNPJ inválido.";
  return null;
}
