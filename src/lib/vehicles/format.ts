/**
 * O formulário virou uma linha só ("Veículo"), então marca e ano ficaram vazios
 * nos carros novos e só sobrevivem nos antigos. Montar o texto na mão deixava
 * espaço sobrando (" Cruze") ou "undefined" quando faltava placa.
 */
type VehicleLike = {
  brand?: string | null;
  model?: string | null;
  plate?: string | null;
};

/** "Marca Modelo", ou só o que estiver preenchido. */
export function vehicleName(vehicle: VehicleLike, fallback = "Veículo") {
  const name = [vehicle.brand?.trim(), vehicle.model?.trim()]
    .filter(Boolean)
    .join(" ");
  return name || fallback;
}

/** "Marca Modelo - PLACA", sem o traço quando o carro ainda não tem placa. */
export function vehicleLabel(vehicle: VehicleLike, fallback = "Veículo") {
  const plate = vehicle.plate?.trim();
  const name = vehicleName(vehicle, fallback);
  return plate ? `${name} - ${plate}` : name;
}
