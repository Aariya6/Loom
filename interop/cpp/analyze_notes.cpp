#include <algorithm>
#include <cstddef>
#include <iostream>
#include <numeric>
#include <vector>
int main(){ std::vector<double> v; double x; while(std::cin>>x) v.push_back(x); if(v.empty()){std::cout<<"0 0\n";return 0;} const double sum=std::accumulate(v.begin(),v.end(),0.0); std::cout<<v.size()<<" "<<sum/v.size()<<"\n"; return 0; }
