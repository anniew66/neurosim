// granule_growth.cc
#include "biodynamo.h"
#include <cmath>


namespace bdm {

// Parameter group for our simulation
struct GranuleParam : public ParamGroup {
  BDM_PARAM_GROUP_HEADER(GranuleParam, 1);
  double chemo_diffusion = 100.0; // axon promiscuity
  double chemo_decay = 0.01; // axon promiscuity NEEDS INPUT
  double chemo_secretion_rate = 1.0;// ap NEEDS INPUT
  double step_size = 1.0; // fine
  double synapse_radius = 2.0; // needs parameter
};

// Behavior for growth-cone guided by chemotaxis
class GrowthConeChemotaxis : public Behavior {
 public:
  GrowthConeChemotaxis() {}
  GrowthConeChemotaxis(const GrowthConeChemotaxis& other) : Behavior(other) {}
  Behavior* DeepCopy() const override { return new GrowthConeChemotaxis(*this); }

  void Run(Agent* agent) override {
    auto* rm = Simulation::GetActive()->GetResourceManager();
    auto pos = agent->GetPosition();
    double conc = rm->GetSubstanceConcentration("Chemo", pos);
    auto gradient = rm->GetSubstanceGradient("Chemo", pos);

    vec3 dir;
    if (gradient.Norm() > 1e-6) {
      dir = gradient.Normalized();
    } else {
      dir = RandomUnitVector();
    }

    auto* param = GetParam<GranuleParam>();
    if (conc > 1e-3) {
      vec3 new_pos = pos + dir * param->step_size;
      auto* new_elem = new NeuriteElement();
      new_elem->SetPosition(new_pos);
      new_elem->AddBehavior(new GrowthConeChemotaxis());
      rm->AddAgent(new_elem);
    }

    // Simple synapse logic: find nearby target agents
    auto nearby = rm->GetEnvironment()->GetNearby(pos, param->synapse_radius);
    for (auto* other : nearby) {
      if (other->GetName() == "Target") {
        // tag both as connected
        agent->SetUserDefinedInt("connected_to", other->GetUid());
        other->SetUserDefinedInt("connected_to", agent->GetUid());
        break;
      }
    }
  }
};

inline bool IsTarget(Agent* a) {
  return a->GetName() == "Target";
}

// The main simulation function
inline int Simulate(int argc, const char** argv) {
  Simulation sim(argc, argv);

  Param::RegisterParamGroup<GranuleParam>();

  auto* rm = sim.GetResourceManager();

  // Create chemo substance
  rm->CreateSubstance("Chemo",
                      Param<GranuleParam>::Get()->chemo_diffusion,
                      Param<GranuleParam>::Get()->chemo_decay);

  // Create a chemo source
  Agent* source = new Agent();
  source->SetPosition({50, 0, 50}); // SWAP WITH NEURON POSITIONS, ITERATE OVER EACH NEURON IN LIST
  source->SetName("ChemoSource"); // UNIQUE IDS
  source->AddBehavior(new Secretion("Chemo",
                     Param<GranuleParam>::Get()->chemo_secretion_rate)); // FILL IN SECRETION RATE PARAM ON WEB APP
  rm->AddAgent(source);

  // Optionally: create a dummy 'target' arbor
  Agent* target = new Agent();
  target->SetPosition({100, 0, 100});
  target->SetName("Target");
  rm->AddAgent(target);

  // Create granule soma
  Agent* soma = new Agent();
  soma->SetPosition({0, 0, 0});
  soma->SetName("GranuleSoma");
  rm->AddAgent(soma);

  // Initial neurite element (axon stub)
  NeuriteElement* axon = new NeuriteElement();
  axon->SetPosition(soma->GetPosition() + vec3(0, -1, 0));
  axon->AddBehavior(new GrowthConeChemotaxis());
  rm->AddAgent(axon);

  sim.GetScheduler()->Simulate(5000);

  return 0;
}

}  // namespace bdm

BDM_INIT_SIMULATION(bdm::Simulate)
