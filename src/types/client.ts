export interface Vehicle {
  id: string;
  client_id: string;
  brand: string;
  model: string;
  plate: string;
  year: number | null;
  photo_url_1: string | null;
  photo_url_2: string | null;
  /** Veículo de marcação criado junto de um pré-cadastro: marca/modelo/placa ainda vazios. */
  pre_cadastro?: boolean;
}

export interface Client {
  id: string;
  workshop_id: string;
  name: string;
  phone: string;
  notes: string | null;
  email: string | null;
  document: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
  vehicles?: Vehicle[];
  /** Criado pela agenda sem dados completos. Telefone fica vazio até alguém finalizar o cadastro. */
  pre_cadastro?: boolean;
}

export type VehicleFormItem = {
  uiKey?: string;
  id?: string;
  brand: string;
  model: string;
  plate: string;
  year: string;
  photoUrl1: string | null;
  photoUrl2: string | null;
  photoFile1: File | null;
  photoFile2: File | null;
  previewUrl1: string | null;
  previewUrl2: string | null;
  removePhoto1: boolean;
  removePhoto2: boolean;
};

export type ClientFormData = {
  name: string;
  phone: string;
  notes: string;
  vehicles: VehicleFormItem[];
};

export const emptyVehicle: VehicleFormItem = {
  brand: "",
  model: "",
  plate: "",
  year: "",
  photoUrl1: null,
  photoUrl2: null,
  photoFile1: null,
  photoFile2: null,
  previewUrl1: null,
  previewUrl2: null,
  removePhoto1: false,
  removePhoto2: false,
};

export const emptyClientForm: ClientFormData = {
  name: "",
  phone: "",
  notes: "",
  vehicles: [],
};
