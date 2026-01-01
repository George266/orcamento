export const mockDashboardData = {
    "2023-10": {
        totalPactuado: 152450,
        totalOfertado: 145800,
        impactoFinanceiro: {
            sigtap: 2850000,
            incentivos: 1400000
        },
        alertas: [
            { id: 1, tipo: "sem_oferta", item: "0204 - Ressonância Magnética", instituto: "Hospital Geral" },
            { id: 2, tipo: "abaixo_meta", item: "0301 - Consultas Médicas", instituto: "Instituto Alfa", atingimento: 72 }
        ],
        grupos: [
            { nome: "0301 - Consultas Médicas", pactuado: 85000, ofertado: 85000, status: 100 },
            { nome: "0204 - Ressonância Magnética", pactuado: 1200, ofertado: 0, status: 0 },
            { nome: "0401 - Pequenas Cirurgias", pactuado: 5000, ofertado: 4200, status: 84 }
        ]
    },
    "2023-11": {
        totalPactuado: 155000,
        totalOfertado: 151000,
        impactoFinanceiro: {
            sigtap: 2900000,
            incentivos: 1450000
        },
        alertas: [
            { id: 3, tipo: "abaixo_meta", item: "0401 - Pequenas Cirurgias", instituto: "Hospital Delta", atingimento: 65 }
        ],
        grupos: [
            { nome: "0301 - Consultas Médicas", pactuado: 88000, ofertado: 87500, status: 99 },
            { nome: "0204 - Ressonância Magnética", pactuado: 1200, ofertado: 1100, status: 91 },
            { nome: "0401 - Pequenas Cirurgias", pactuado: 5500, ofertado: 3500, status: 63 }
        ]
    }
};
